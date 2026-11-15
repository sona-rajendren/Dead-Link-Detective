/** The complete report as pretty-printed JSON (best for other programs). */
export function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
