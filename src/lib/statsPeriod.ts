export type PeriodQuery = {
  period?: string;
  month?: string;
  year?: string;
  date?: string;
};

/** Append SQL date filter; column e.g. `updatedAt` or `o.createdAt`. */
export function periodSql(
  column: string,
  query: PeriodQuery
): { sql: string; params: string[] } {
  const period = typeof query.period === "string" ? query.period : "all";
  const params: string[] = [];
  let sql = "";

  if (period === "day") {
    const d = typeof query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : null;
    if (d) {
      sql += ` AND date(${column}, 'localtime') = date(?)`;
      params.push(d);
    } else {
      sql += ` AND date(${column}, 'localtime') = date('now', 'localtime')`;
    }
  } else if (period === "month") {
    const m =
      typeof query.month === "string" && /^\d{4}-\d{2}$/.test(query.month) ? query.month : null;
    if (m) {
      sql += ` AND strftime('%Y-%m', ${column}, 'localtime') = ?`;
      params.push(m);
    } else {
      sql += ` AND strftime('%Y-%m', ${column}, 'localtime') = strftime('%Y-%m', 'now', 'localtime')`;
    }
  } else if (period === "year") {
    const y = typeof query.year === "string" && /^\d{4}$/.test(query.year) ? query.year : null;
    if (y) {
      sql += ` AND strftime('%Y', ${column}, 'localtime') = ?`;
      params.push(y);
    } else {
      sql += ` AND strftime('%Y', ${column}, 'localtime') = strftime('%Y', 'now', 'localtime')`;
    }
  }

  return { sql, params };
}
