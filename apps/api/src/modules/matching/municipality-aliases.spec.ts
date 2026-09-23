import { resolveMunicipalityAlias } from './municipality-aliases';

describe('resolveMunicipalityAlias', () => {
  it('resolves the client-reported "South Deerfield" village to the official town of Deerfield', () => {
    expect(resolveMunicipalityAlias('South Deerfield')).toBe('deerfield');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolveMunicipalityAlias('  SOUTH DEERFIELD  ')).toBe('deerfield');
  });

  it('passes through an official municipality name unchanged (lowercased)', () => {
    expect(resolveMunicipalityAlias('Lawrence')).toBe('lawrence');
    expect(resolveMunicipalityAlias('Worcester')).toBe('worcester');
  });

  it('passes through an unknown/unmapped name unchanged rather than guessing', () => {
    expect(resolveMunicipalityAlias('Some Made Up Village')).toBe('some made up village');
  });

  it('resolves a Boston neighborhood alias', () => {
    expect(resolveMunicipalityAlias('Jamaica Plain')).toBe('boston');
  });
});
