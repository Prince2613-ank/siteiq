import { Inject, Injectable, Logger } from '@nestjs/common';
import { IdentityStatus, MatchStrategy } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { houseNumbersMatch, normalizeAddress, splitStreetNameAndSuffix } from './address-normalizer';
import { ParcelMirrorRepository, ParcelMirrorRow } from './parcel-mirror.repository';
import { Geocoder, GEOCODER } from './geocoder.interface';
import { bigramSimilarity } from './string-similarity';
import {
  CandidateSignals,
  CONFLICT_CONFIDENCE_CAP,
  DEFAULT_SEARCH_RADIUS_METERS,
  EXPANDED_SEARCH_LIMIT,
  EXPANDED_SEARCH_RADIUS_METERS,
  ScoredCandidate,
  scoreCandidate,
} from './scoring';
import { resolveMunicipalityAlias } from './municipality-aliases';
import { extractLocationClues } from './location-clues';

export interface MatchInput {
  address?: string;
  parcelRef?: string;
  lat?: number;
  lng?: number;
  /// Town/municipality clue, used when no full address is available to
  /// derive one from (client requirement — location-based identification).
  municipality?: string;
  /// Street/location name clue with no house number required, e.g.
  /// "Marston St" — the client's dataset's "Location" column. Always
  /// preferred over anything parsed from locationDescription.
  locationText?: string;
  /// Free-text location description, e.g. "0.25 mi S of Methuen-Lawrence TL
  /// on Marston St". Supporting evidence only — deterministic clues
  /// (street hint) are extracted from it (location-clues.ts), never used as
  /// the primary matching mechanism (client's explicit instruction: no
  /// NLP interpretation engine).
  locationDescription?: string;
}

/** AGREE = found by both the address-family and spatial searches; CONFLICT
 * = the two searches' top candidates disagree (set post-hoc by
 * applyConflictDetection, overriding whatever this started as); ADDRESS_ONLY
 * / SPATIAL_ONLY = found by only one. Null for the EXACT/FUZZY/PARCEL_ID
 * branches, which are single-method searches by definition — this label
 * only means something once two independent searches exist to agree or
 * disagree (Round 4). */
export type SearchAgreement = 'AGREE' | 'CONFLICT' | 'ADDRESS_ONLY' | 'SPATIAL_ONLY';

interface CandidateDraft {
  row: ParcelMirrorRow;
  signals: CandidateSignals;
  /** Which search stage surfaced this candidate (client requirement: an
   * analyst should be able to see why a candidate appeared) — only set for
   * coordinate-based candidates; null for address/parcel-ID matches, which
   * aren't radius-based at all. Null (not a number) for a candidate found
   * ONLY by the address-family search — it wasn't found via any radius. */
  searchRadiusMeters?: number | null;
  foundBySpatialSearch?: boolean;
  foundByAddressSearch?: boolean;
}

/**
 * The matching pipeline itself (docs/02 §2). Called by the worker
 * (matching.processor.ts) for both the initial lookup at site creation and
 * any later explicit re-match — same code path either way.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private prisma: PrismaService,
    private mirror: ParcelMirrorRepository,
    @Inject(GEOCODER) private geocoder: Geocoder,
    private activity: ActivityService,
  ) {}

  /**
   * Checkpoint 11 hardening: the matching pipeline touches several things
   * that can genuinely fail (DB hiccups, an unexpected data shape, a bug in
   * a strategy branch) beyond what individual adapters already guard
   * (GeocodingService already catches its own errors and degrades to "no
   * coordinate," per docs/01 §7/§12). Before this fix, an uncaught
   * exception here left BullMQ retrying 3 times and then giving up
   * SILENTLY — Site.identityStatus stayed IDENTIFYING forever, and the
   * analyst had no way to know matching had failed short of asking a
   * developer to check logs. Now: any failure degrades to the SAME
   * NO_MATCH state a genuine "found nothing" result produces — the
   * Candidate Review screen's existing "try another address / enter
   * coordinates / search manually" recovery path covers this case too,
   * with no new UI state needed — while the failure itself is logged
   * distinctly (`match_attempt_error`, not `match_attempt_completed`) so
   * it's still diagnosable, never confused with a legitimate no-match
   * determination in the audit trail.
   */
  async runMatchAttempt(siteId: string, input: MatchInput, triggeredById: string) {
    try {
      return await this.runMatchAttemptUnsafe(siteId, input, triggeredById);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Matching pipeline failed for site ${siteId}: ${message}`, (err as Error).stack);

      const site = await this.prisma.site.findUnique({ where: { id: siteId } });
      if (!site) return; // site was deleted mid-flight — nothing left to update

      await this.prisma.site.update({ where: { id: siteId }, data: { identityStatus: IdentityStatus.NO_MATCH } });
      await this.activity.log({
        organizationId: site.organizationId,
        siteId,
        actorId: triggeredById,
        eventType: 'match_attempt_error',
        metadata: { error: message },
      });
    }
  }

  private async runMatchAttemptUnsafe(siteId: string, input: MatchInput, triggeredById: string) {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const normalized = input.address ? normalizeAddress(input.address) : null;

    const { strategy, drafts } = await this.findCandidates(input, normalized);

    const scoredAll = drafts.map((d) => ({
      row: d.row,
      searchRadiusMeters: d.searchRadiusMeters ?? null,
      foundBySpatialSearch: d.foundBySpatialSearch ?? false,
      foundByAddressSearch: d.foundByAddressSearch ?? false,
      ...scoreCandidate(d.signals),
    }));
    this.applyConflictDetection(scoredAll);
    const scored = scoredAll.sort((a, b) => b.confidence - a.confidence).slice(0, 5);

    const attempt = await this.prisma.matchAttempt.create({
      data: {
        siteId,
        inputSnapshot: input as any,
        strategyUsed: strategy,
        candidateCount: scored.length,
        topConfidence: scored[0]?.confidence ?? null,
        triggeredById,
      },
    });

    for (let i = 0; i < scored.length; i++) {
      const c = scored[i];
      const duplicateOfSiteId = await this.findActiveDuplicateSite(
        site.organizationId,
        c.row.parcelRef,
        siteId,
      );

      await this.prisma.siteMatchCandidate.create({
        data: {
          siteId,
          attemptId: attempt.id,
          parcelRef: c.row.parcelRef,
          matchedAddress: c.row.address,
          municipality: c.row.municipality,
          confidence: c.confidence,
          evidence: {
            ...c.evidence,
            searchRadiusMeters: c.searchRadiusMeters,
            // Round 4 evidence model: which independent search(es) found
            // this candidate, and whether they agree. Null for
            // EXACT/FUZZY/PARCEL_ID strategies — those are single-method
            // searches by definition, so "agreement" isn't a meaningful
            // question for them.
            agreement: this.classifyAgreement(c),
            sourceName: c.row.sourceName,
            sourceUrl: null,
            retrievedAt: c.row.sourceRefreshedAt.toISOString(),
            // Source freshness is reported SEPARATELY from confidence —
            // client requirement (Checkpoint 6 review): a 94% match on
            // 3-day-old source data and a 94% match on 14-month-old source
            // data are not equally reliable, even though the matching
            // signals themselves score identically. The scoring formula
            // itself is unchanged; this is purely a transparency field the
            // UI surfaces alongside confidence, not folded into it.
            sourceAgeDays: Math.floor(
              (Date.now() - c.row.sourceRefreshedAt.getTime()) / (1000 * 60 * 60 * 24),
            ),
          } as any,
          rank: i + 1,
          duplicateOfSiteId: duplicateOfSiteId ?? undefined,
        },
      });
    }

    const newIdentityStatus =
      scored.length === 0 ? IdentityStatus.NO_MATCH : IdentityStatus.NEEDS_REVIEW;

    // Re-match conflict handling (docs/02 §2.3, client Checkpoint 7
    // requirement): if this site was already CONFIRMED and the new top
    // candidate points at a DIFFERENT parcel, we flip identityStatus to
    // NEEDS_REVIEW (so a human decision is required again) but deliberately
    // leave Site.parcelRef/matchConfidence/matchMethod untouched — the
    // previously confirmed identity is not silently replaced. A candidate
    // list looking the same as a fresh match would hide that this is a
    // conflict with prior work, so it's logged distinctly.
    const wasConfirmed = site.identityStatus === IdentityStatus.CONFIRMED;
    const topCandidateParcelRef = scored[0]?.row.parcelRef ?? null;
    const isReMatchConflict =
      wasConfirmed && topCandidateParcelRef !== null && topCandidateParcelRef !== site.parcelRef;

    await this.prisma.site.update({
      where: { id: siteId },
      data: { identityStatus: newIdentityStatus },
    });

    await this.activity.log({
      organizationId: site.organizationId,
      siteId,
      actorId: triggeredById,
      eventType: 'match_attempt_completed',
      metadata: {
        attemptId: attempt.id,
        strategyUsed: strategy,
        candidateCount: scored.length,
        topConfidence: scored[0]?.confidence ?? null,
      },
    });

    if (isReMatchConflict) {
      await this.activity.log({
        organizationId: site.organizationId,
        siteId,
        actorId: triggeredById,
        eventType: 'rematch_conflict_detected',
        metadata: {
          attemptId: attempt.id,
          previouslyConfirmedParcelRef: site.parcelRef,
          newTopCandidateParcelRef: topCandidateParcelRef,
        },
      });
      this.logger.warn(
        `Re-match for site ${siteId} found a different top candidate (${topCandidateParcelRef}) than the currently confirmed parcel (${site.parcelRef}) — requires explicit re-confirmation, not auto-replaced.`,
      );
    }

    this.logger.log(
      `MatchAttempt ${attempt.id} for site ${siteId}: strategy=${strategy}, candidates=${scored.length}, top=${scored[0]?.confidence ?? 'n/a'}`,
    );

    return attempt;
  }

  private async findCandidates(
    input: MatchInput,
    normalized: ReturnType<typeof normalizeAddress> | null,
  ): Promise<{ strategy: MatchStrategy; drafts: CandidateDraft[] }> {
    // Town clue — from a full address if one was given, otherwise the
    // caller-supplied municipality clue (client requirement — location-
    // based identification works without a full address). Resolved through
    // the narrow alias table (docs: municipality-aliases.ts) so a village/
    // locality name (e.g. "South Deerfield") still matches MassGIS's
    // official municipality name (e.g. "Deerfield").
    const clueCity = normalized?.city ?? input.municipality ?? null;
    const resolvedCity = clueCity ? resolveMunicipalityAlias(clueCity) : null;

    // 1. Parcel ID given — highest-priority, most direct path.
    if (input.parcelRef) {
      const row = await this.mirror.findByParcelRef(input.parcelRef);
      if (row) {
        const distanceMeters =
          input.lat !== undefined && input.lng !== undefined
            ? await this.mirror.distanceTo(row.parcelRef, input.lat, input.lng)
            : null;
        return {
          strategy: MatchStrategy.PARCEL_ID,
          drafts: [
            {
              row,
              signals: {
                addressSimilarity: normalized?.streetLine
                  ? bigramSimilarity(normalized.streetLine, row.address)
                  : null,
                distanceMeters,
                parcelIdMatch: true,
                municipalityMatch: this.municipalityMatches(resolvedCity, row),
                pointInParcel: null,
                locationTextSimilarity: null,
                houseNumberMatch: null,
                streetSuffixMatch: null,
              },
            },
          ],
        };
      }
      // Parcel ID didn't resolve — fall through to address/coordinate strategies below.
    }

    // 2. Address given — exact, then fuzzy. Unchanged mechanism; only the
    // municipality filter now goes through alias resolution.
    if (normalized?.streetLine) {
      const exact = await this.mirror.findExact(normalized.streetLine, resolvedCity);
      if (exact.length > 0) {
        return {
          strategy: MatchStrategy.EXACT,
          drafts: exact.map((row) => ({
            row,
            signals: {
              addressSimilarity: 1,
              distanceMeters: null,
              parcelIdMatch: null,
              municipalityMatch: this.municipalityMatches(resolvedCity, row),
              pointInParcel: null,
              locationTextSimilarity: null,
              houseNumberMatch: null,
              streetSuffixMatch: null,
            },
          })),
        };
      }

      const fuzzy = await this.mirror.findFuzzy(normalized.streetLine, resolvedCity);
      if (fuzzy.length > 0) {
        return {
          strategy: MatchStrategy.FUZZY,
          drafts: fuzzy.map((row) => ({
            row,
            signals: {
              addressSimilarity: row.similarity,
              distanceMeters: null,
              parcelIdMatch: null,
              municipalityMatch: this.municipalityMatches(resolvedCity, row),
              pointInParcel: null,
              locationTextSimilarity: null,
              houseNumberMatch: null,
              streetSuffixMatch: null,
            },
          })),
        };
      }
    }

    // 3. Coordinate / location-clue identification — client's location-
    // based pipeline. Runs whenever a coordinate is available: supplied
    // directly, geocoded from a full address, or (when there is no address
    // at all) geocoded from a synthesized "<street clue>, <town>, MA"
    // string built from the location text / description clues.
    const hasFullAddress = !!normalized?.streetLine;
    let lat = input.lat;
    let lng = input.lng;

    if ((lat === undefined || lng === undefined) && input.address) {
      const geocoded = await this.geocoder.geocode(input.address);
      if (geocoded) {
        lat = geocoded.lat;
        lng = geocoded.lng;
      }
    }

    const descriptionClues = extractLocationClues(input.locationDescription);
    // Location text is preferred; the description is supporting evidence
    // only, so its parsed street hint is used strictly as a fallback.
    const clueStreetText = hasFullAddress ? null : (input.locationText ?? descriptionClues.streetHint);

    if ((lat === undefined || lng === undefined) && !input.address && clueStreetText && (input.municipality || clueCity)) {
      const synthesized = `${clueStreetText}, ${input.municipality ?? clueCity}, MA`;
      const geocoded = await this.geocoder.geocode(synthesized);
      if (geocoded) {
        lat = geocoded.lat;
        lng = geocoded.lng;
      }
    }

    // Parse the clue ONCE — house number and street base/suffix, isolated
    // from any trailing free-text noise (address-normalizer's
    // suffix-truncation handles that). Needed before EITHER search below.
    const clueParsed = clueStreetText ? normalizeAddress(clueStreetText) : null;
    const clueSplit = splitStreetNameAndSuffix(clueParsed?.streetName ?? null);

    interface MergedEntry {
      row: ParcelMirrorRow;
      pointInParcel: boolean;
      distanceMeters: number | null;
      searchRadiusMeters: number | null;
      foundBySpatialSearch: boolean;
      foundByAddressSearch: boolean;
    }
    const merged = new Map<string, MergedEntry>();

    // Address-family search (Round 4, client requirement): municipality +
    // street (+ house number when available), via the SAME findExact/
    // findFuzzy repository methods the full-address EXACT/FUZZY branch
    // above already uses — proven, already indexed (parcel_mirror_
    // address_trgm_idx). Deliberately NOT limited by coordinate distance
    // at all — this is what lets a genuinely far-away real match (Milton:
    // 444m) still be found, instead of only ever searching a radius.
    if (clueSplit.base && resolvedCity) {
      const suffixPart = clueSplit.suffix ? ` ${clueSplit.suffix}` : '';
      const clueStreetLine = clueParsed?.houseNumber
        ? `${clueParsed.houseNumber} ${clueSplit.base}${suffixPart}`
        : `${clueSplit.base}${suffixPart}`;
      const exactAddr = await this.mirror.findExact(clueStreetLine, resolvedCity);
      const addressRows = exactAddr.length > 0 ? exactAddr : await this.mirror.findFuzzy(clueStreetLine, resolvedCity);
      for (const row of addressRows) {
        const existing = merged.get(row.parcelRef);
        if (existing) {
          existing.foundByAddressSearch = true;
        } else {
          merged.set(row.parcelRef, {
            row,
            pointInParcel: false,
            distanceMeters: null,
            searchRadiusMeters: null,
            foundBySpatialSearch: false,
            foundByAddressSearch: true,
          });
        }
      }
    }

    if (lat !== undefined && lng !== undefined) {
      const [containing, nearbyStage1] = await Promise.all([
        this.mirror.findContainingPoint(lat, lng),
        this.mirror.findNearby(lat, lng, DEFAULT_SEARCH_RADIUS_METERS),
      ]);

      for (const row of containing) {
        const existing = merged.get(row.parcelRef);
        if (existing) {
          existing.pointInParcel = true;
          existing.foundBySpatialSearch = true;
          existing.searchRadiusMeters ??= DEFAULT_SEARCH_RADIUS_METERS;
        } else {
          merged.set(row.parcelRef, {
            row,
            pointInParcel: true,
            distanceMeters: null,
            searchRadiusMeters: DEFAULT_SEARCH_RADIUS_METERS,
            foundBySpatialSearch: true,
            foundByAddressSearch: false,
          });
        }
      }
      for (const row of nearbyStage1) {
        const existing = merged.get(row.parcelRef);
        if (existing) {
          existing.distanceMeters = row.distanceMeters;
          existing.foundBySpatialSearch = true;
          existing.searchRadiusMeters ??= DEFAULT_SEARCH_RADIUS_METERS;
        } else {
          merged.set(row.parcelRef, {
            row,
            pointInParcel: false,
            distanceMeters: row.distanceMeters,
            searchRadiusMeters: DEFAULT_SEARCH_RADIUS_METERS,
            foundBySpatialSearch: true,
            foundByAddressSearch: false,
          });
        }
      }

      // Adaptive stage 2 (Round 3, client requirement — the Milton
      // pattern): the clue supplies a house number, but nothing within the
      // tight radius confirms it. Kept alongside the new address-family
      // search deliberately — the address search finds a genuinely far
      // match by text, but stage 2 still lets pure SPATIAL evidence
      // (distance/containment) stay meaningful for records with a street
      // clue but no house number to hunt for by text.
      if (clueParsed?.houseNumber) {
        const stage1Confirms = Array.from(merged.values()).some(
          ({ row, foundBySpatialSearch }) => foundBySpatialSearch && houseNumbersMatch(clueParsed, normalizeAddress(row.address)) === true,
        );
        if (!stage1Confirms) {
          const nearbyStage2 = await this.mirror.findNearby(lat, lng, EXPANDED_SEARCH_RADIUS_METERS, EXPANDED_SEARCH_LIMIT);
          for (const row of nearbyStage2) {
            const existing = merged.get(row.parcelRef);
            if (existing) {
              existing.foundBySpatialSearch = true;
              existing.searchRadiusMeters ??= EXPANDED_SEARCH_RADIUS_METERS;
              if (existing.distanceMeters === null) existing.distanceMeters = row.distanceMeters;
            } else {
              merged.set(row.parcelRef, {
                row,
                pointInParcel: false,
                distanceMeters: row.distanceMeters,
                searchRadiusMeters: EXPANDED_SEARCH_RADIUS_METERS,
                foundBySpatialSearch: true,
                foundByAddressSearch: false,
              });
            }
          }
        }
      }

      // Every merged row needs a distance value for evidence/transparency,
      // including ones the address search found on its own (Milton: still
      // worth showing "444m from the supplied coordinate" even though
      // that's not how the candidate was found).
      for (const entry of merged.values()) {
        if (entry.distanceMeters === null) {
          entry.distanceMeters = await this.mirror.distanceTo(entry.row.parcelRef, lat, lng);
        }
      }
    }

    if (merged.size > 0) {
      const drafts: CandidateDraft[] = Array.from(merged.values()).map(
        ({ row, pointInParcel, distanceMeters, searchRadiusMeters, foundBySpatialSearch, foundByAddressSearch }) => {
          const rowParsed = normalizeAddress(row.address);
          const rowSplit = splitStreetNameAndSuffix(rowParsed.streetName);

          // Base street name only (suffix excluded) — client requirement:
          // a shared base word must not hide a different street type.
          const locationTextSimilarity =
            clueSplit.base && rowSplit.base ? bigramSimilarity(clueSplit.base, rowSplit.base) : null;

          // House number — independent, strongly-weighted signal (client
          // requirement: "73 Granite Ave" must not score the same as
          // "Granite Ave"). Accounts for hyphenated ranges and
          // combined-parcel double numbers (real data: Sterling, Milton).
          const houseNumberMatch = clueParsed ? houseNumbersMatch(clueParsed, rowParsed) : null;

          // Suffix agreement — independent signal (client requirement:
          // "Creamery Ave" vs. "Creamery Lane" must be distinguishable).
          const streetSuffixMatch =
            clueSplit.suffix && rowSplit.suffix ? clueSplit.suffix === rowSplit.suffix : null;

          return {
            row,
            searchRadiusMeters,
            foundBySpatialSearch,
            foundByAddressSearch,
            signals: {
              addressSimilarity: normalized?.streetLine
                ? bigramSimilarity(normalized.streetLine, row.address)
                : null,
              distanceMeters,
              parcelIdMatch: null,
              municipalityMatch: this.municipalityMatches(resolvedCity, row),
              pointInParcel,
              locationTextSimilarity,
              houseNumberMatch,
              streetSuffixMatch,
            },
          };
        },
      );
      return { strategy: MatchStrategy.SPATIAL, drafts };
    }

    // 4. Nothing resolved anything — genuinely no reliable match (KT §12).
    return { strategy: input.address ? MatchStrategy.FUZZY : MatchStrategy.SPATIAL, drafts: [] };
  }

  /**
   * Client-mandated conflict detection: if the candidate spatial evidence
   * (distance/containment) most strongly favors points at a DIFFERENT
   * parcel than the candidate house-number evidence most strongly favors,
   * that's a genuine disagreement between two independent signals — not
   * something to silently average away. Both candidates get flagged and
   * capped, rather than letting the coordinate-favored one look
   * confidently correct. Operates across the whole candidate set for one
   * MatchAttempt, so it runs AFTER scoring but BEFORE the top-5 slice.
   *
   * Deliberately keyed off houseNumberMatch (not the softer
   * locationTextSimilarity) — a house-number match is specific and
   * unambiguous; a moderate text-similarity score isn't strong enough
   * grounds to declare a conflict against the spatial favorite.
   */
  private applyConflictDetection(scored: (ScoredCandidate & { row: ParcelMirrorRow })[]): void {
    // Excludes addressEvidenceConflict candidates deliberately: a
    // coincidental house-number match on the WRONG street (real Milton
    // pattern: "73 Courtland Cir") is not genuine address evidence for
    // that candidate — it already contradicts itself internally (capped
    // by ADDRESS_CONTRADICTION_CONFIDENCE_CAP) and must not be picked as
    // the "best address" side of a cross-search conflict, or a
    // spatially-boosted false match can mask the real disagreement.
    const bestAddress = scored
      .filter((c) => c.evidence.houseNumberMatch === true && !c.evidence.addressEvidenceConflict)
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (!bestAddress) return;

    const bestSpatial = scored
      .filter((c) => c.evidence.pointInParcel === true)
      .sort((a, b) => (b.evidence.distanceScore ?? 0) - (a.evidence.distanceScore ?? 0))[0];
    if (!bestSpatial) return;

    if (bestSpatial.row.parcelRef === bestAddress.row.parcelRef) return;

    bestSpatial.evidence.conflictDetected = true;
    bestSpatial.evidence.identityEvidenceConflict = true;
    bestSpatial.evidence.conflictingCandidateParcelRef = bestAddress.row.parcelRef;
    bestSpatial.evidence.manualVerificationRequired = true;
    bestSpatial.confidence = Math.min(bestSpatial.confidence, CONFLICT_CONFIDENCE_CAP);

    bestAddress.evidence.conflictDetected = true;
    bestAddress.evidence.identityEvidenceConflict = true;
    bestAddress.evidence.conflictingCandidateParcelRef = bestSpatial.row.parcelRef;
    bestAddress.evidence.manualVerificationRequired = true;
  }

  /**
   * Round 4 evidence model: which independent search(es) — address-family
   * text search, spatial coordinate search — found this candidate, and
   * whether they agree. Purely descriptive (never affects confidence);
   * CONFLICT takes precedence when applyConflictDetection has already
   * flagged this candidate as one half of a cross-search disagreement.
   */
  private classifyAgreement(c: {
    foundBySpatialSearch: boolean;
    foundByAddressSearch: boolean;
    evidence: { conflictDetected: boolean };
  }): SearchAgreement | null {
    if (!c.foundBySpatialSearch && !c.foundByAddressSearch) return null; // EXACT/FUZZY/PARCEL_ID — not applicable
    if (c.evidence.conflictDetected) return 'CONFLICT';
    if (c.foundBySpatialSearch && c.foundByAddressSearch) return 'AGREE';
    return c.foundByAddressSearch ? 'ADDRESS_ONLY' : 'SPATIAL_ONLY';
  }

  private municipalityMatches(resolvedCity: string | null, row: ParcelMirrorRow): boolean | null {
    if (!resolvedCity) return null;
    return resolvedCity === resolveMunicipalityAlias(row.municipality);
  }

  /** Does any OTHER active site in this org already have this parcelRef confirmed/pending? */
  private async findActiveDuplicateSite(
    organizationId: string,
    parcelRef: string,
    excludeSiteId: string,
  ): Promise<string | null> {
    const existing = await this.prisma.site.findFirst({
      where: {
        organizationId,
        parcelRef,
        deletedAt: null,
        id: { not: excludeSiteId },
      },
      select: { id: true },
    });
    return existing?.id ?? null;
  }
}
