// Turns Aufmass records into revenue per employee and service day (Mitarbeiterwert, after the 0.9 factor).
// Nothing is split on a guess: a report with several workers and no personal assignment raises a warning.
import { crewReports, employeeShares, normalizeFinancialData, reportCost, reportTotals } from '../vendor/aufmass/business.ts';
import { isTimeReport, reportDays, timePricingComplete } from '../vendor/aufmass/time-reports.ts';
import type { Data, Line, Project, Report } from '../vendor/aufmass/types.ts';
import type { NuRow, RevenueRow } from '../calc/month.ts';

export type Record_ = { id: string; kind: string; data: string };
export type AufmassImport = {
  revenue: RevenueRow[]; nu: NuRow[]; warnings: string[];
  unchecked: { day: string; project: string }[];
};

export function parseRecords(rows: Record_[]): Data {
  const data = { projects: [], positions: [], reports: [], files: [], closures: [], payments: [], packages: [], audit: [], weekRecords: [] } as Data;
  for (const r of rows) {
    try {
      if (r.kind === 'project') data.projects.push(JSON.parse(r.data));
      else if (r.kind === 'report') data.reports.push(JSON.parse(r.data));
    } catch { /* unreadable record is skipped, the count of reports shows the gap */ }
  }
  return normalizeFinancialData(data);
}

// A report is split by service day first, then by crew, so crew shares apply per day.
function byServiceDay(r: Report): Report[] {
  if (isTimeReport(r)) return reportDays(r);
  const groups = new Map<string, Line[]>();
  for (const l of r.lines) {
    const d = (l.serviceDate || r.date || '').slice(0, 10);
    (groups.get(d) || groups.set(d, []).get(d)!).push(l);
  }
  return [...groups].map(([day, lines]) => ({ ...r, date: day, endDate: day, lines }));
}

export function importAufmass(
  data: Data, month: string, opts: { allowEqualSplit?: boolean } = {},
): AufmassImport {
  const out: AufmassImport = { revenue: [], nu: [], warnings: [], unchecked: [] };
  const project = new Map<string, Project>(data.projects.map((p) => [p.id, p]));
  const planOf = new Map<string, string>();
  for (const p of data.projects) for (const e of p.employees || []) {
    if (!e.planId) continue;
    planOf.set(e.id, e.planId);
    for (const old of e.legacyIds || []) planOf.set(old, e.planId);
  }
  const nuByProject = new Map<string, Report[]>();
  const missing = new Set<string>();
  const drafts = new Set<string>();

  for (const report of data.reports) {
    const proj = project.get(report.projectId);
    if (!proj) continue;
    const factor = proj.factor ?? 0.9;
    const days = byServiceDay(report).filter((d) => (d.date || '').startsWith(month));
    if (!days.length) continue;
    if (report.state === 'draft') { drafts.add(proj.number + ' ' + proj.name); continue; }
    for (const day of days) {
      for (const sub of crewReports(day, factor)) {
        const label = `${proj.number} ${proj.name}`;
        const dayKey = (sub.date || '').slice(0, 10);
        if (sub.review !== 'approved') out.unchecked.push({ day: dayKey, project: label });
        if (sub.teamWork) { // subcontractor crew: feeds the NU project bonus, not a personal bonus
          const list = nuByProject.get(proj.id) || [];
          list.push(sub);
          nuByProject.set(proj.id, list);
          continue;
        }
        const members = sub.employeeMembers || [];
        if (!members.length) { out.warnings.push(`${label} ${dayKey}: Aufmaß ohne Mitarbeiter.`); continue; }
        if (!timePricingComplete(sub)) { out.warnings.push(`${label} ${dayKey}: Preise unvollständig, kein Umsatz übernommen.`); continue; }
        const personal = isTimeReport(sub) || members.length === 1;
        if (!personal && !opts.allowEqualSplit) {
          out.warnings.push(`${label} ${dayKey}: Zuordnung fehlt (${members.length} Mitarbeiter ohne persönliche Zuordnung), Umsatz nicht übernommen.`);
          continue;
        }
        for (const share of employeeShares(sub, factor)) {
          const id = planOf.get(share.employeeId);
          if (!id) { missing.add(share.name); continue; }
          out.revenue.push({ resourceId: id, day: dayKey, projectId: proj.id, cents: share.employee, approved: sub.review === 'approved' });
        }
        if (!personal) out.warnings.push(`${label} ${dayKey}: vorläufig gleich verteilt.`);
      }
    }
  }
  for (const name of missing) out.warnings.push(`Mitarbeiter ${name} ist im Aufmaßtool nicht mit der Montageplanung verknüpft.`);
  for (const d of drafts) out.warnings.push(`${d}: Entwürfe im Monat werden nicht gezählt.`);

  for (const [projectId, reports] of nuByProject) {
    const proj = project.get(projectId)!;
    const costs = reports.map(reportCost);
    out.nu.push({
      projectId: proj.planId || proj.id, projectName: `${proj.number} ${proj.name}`, foremanId: null,
      revenue: reportTotals(reports, proj.factor ?? 0.9).employee,
      cost: costs.some((c) => c === null) ? null : costs.reduce<number>((s, c) => s + c!, 0),
      approved: reports.every((r) => r.review === 'approved'),
    });
  }
  return out;
}
