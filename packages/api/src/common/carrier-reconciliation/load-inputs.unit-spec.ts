import { agentNumberMatches } from './load-inputs';

describe('agentNumberMatches', () => {
  it('matches the Dash agent number to the appointment code with or without the A prefix', () => {
    expect(agentNumberMatches('0B9049', ['A0B9049'])).toBe(true);
    expect(agentNumberMatches('a0b9049', ['0B9049'])).toBe(true);
    expect(agentNumberMatches('0B9049', ['A0D3086', 'A0B9049'])).toBe(true);
  });

  it('refuses another agency’s report', () => {
    expect(agentNumberMatches('0D3086', ['A0B9049'])).toBe(false);
    expect(agentNumberMatches('0B9049', [])).toBe(false);
  });
});
