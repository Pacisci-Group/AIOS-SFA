import { AgencyPermission, DataScope } from '@sfa/shared';
import {
  holdsTeamCalendar,
  seesTeamLeave,
  seesTeamPending,
  teamLeaveFilter,
} from './hr-calendar-access';

const TEAM = AgencyPermission.HrTeamCalendar;

const viewer = (
  dataScope: DataScope,
  branchId: string | null,
  permissions: string[] = ['hr:read', TEAM],
) => ({ dataScope, branchId, permissions });

describe('HR calendar access (PAC-169)', () => {
  it('names the dedicated permission, not the reviewer one', () => {
    expect(TEAM).toBe('agency:hr:team_calendar');
    expect(holdsTeamCalendar(viewer(DataScope.Agency, null))).toBe(true);
    // `hr:write` alone decides requests on the Time off page; it does not
    // put anyone else's leave on the calendar.
    expect(
      holdsTeamCalendar(
        viewer(DataScope.Agency, null, ['hr:read', 'hr:write']),
      ),
    ).toBe(false);
  });

  it('reaches every branch from agency scope, one from branch scope, none from own', () => {
    expect(teamLeaveFilter(viewer(DataScope.Agency, null))).toEqual({});
    expect(teamLeaveFilter(viewer(DataScope.Branch, 'north'))).toEqual({
      branchId: 'north',
    });
    expect(teamLeaveFilter(viewer(DataScope.Own, 'north'))).toBeNull();

    expect(seesTeamLeave(viewer(DataScope.Agency, null), 'south')).toBe(true);
    expect(seesTeamLeave(viewer(DataScope.Branch, 'north'), 'north')).toBe(
      true,
    );
    expect(seesTeamLeave(viewer(DataScope.Branch, 'north'), 'south')).toBe(
      false,
    );
    expect(seesTeamLeave(viewer(DataScope.Own, 'north'), 'north')).toBe(false);
  });

  it('reaches nothing from a branch scope with no branch — never everything', () => {
    expect(teamLeaveFilter(viewer(DataScope.Branch, null))).toBeNull();
    expect(seesTeamLeave(viewer(DataScope.Branch, null), 'north')).toBe(false);
    expect(seesTeamLeave(viewer(DataScope.Branch, null), null)).toBe(false);
  });

  it('gives no reach without the permission, however wide the data scope', () => {
    // CRM is branch scope and Data Team agency scope, both with `hr:read` only;
    // a reviewer without the permission is in the same position.
    for (const permissions of [['hr:read'], ['hr:read', 'hr:write']]) {
      const crm = viewer(DataScope.Branch, 'north', permissions);
      const dataTeam = viewer(DataScope.Agency, null, permissions);
      expect(teamLeaveFilter(crm)).toBeNull();
      expect(teamLeaveFilter(dataTeam)).toBeNull();
      expect(seesTeamLeave(crm, 'north')).toBe(false);
      expect(seesTeamLeave(dataTeam, 'north')).toBe(false);
      expect(seesTeamPending(crm)).toBe(false);
      expect(seesTeamPending(dataTeam)).toBe(false);
    }
  });

  it('adds pending requests only for a holder who is also a reviewer', () => {
    const both = ['hr:read', 'hr:write', TEAM];
    expect(seesTeamPending(viewer(DataScope.Agency, null))).toBe(false);
    expect(seesTeamPending(viewer(DataScope.Agency, null, both))).toBe(true);
    expect(seesTeamPending(viewer(DataScope.Branch, 'north', both))).toBe(true);
    // A scope that reaches nobody reaches nobody's pending requests either.
    expect(seesTeamPending(viewer(DataScope.Branch, null, both))).toBe(false);
    expect(seesTeamPending(viewer(DataScope.Own, 'north', both))).toBe(false);
  });
});
