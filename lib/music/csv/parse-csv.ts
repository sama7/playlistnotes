/**
 * A small RFC 4180 CSV reader.
 *
 * Written rather than installed. The format's genuinely hard parts are quoted
 * fields containing commas, newlines and escaped quotes, which is perhaps sixty
 * lines — and the input here is a file a stranger uploads, so a dependency
 * would mean auditing someone else's parser against malicious input anyway.
 * What is added on top of the standard is the small set of real-world defects
 * that actually arrive: a UTF-8 BOM, CRLF endings, and trailing blank lines.
 *
 * Bounds are enforced by the caller, not here, because "too big" depends on
 * what is being parsed.
 */

export interface CsvParseOptions {
  /** Refuse rather than allocate unboundedly. */
  maxRows?: number;
  maxCells?: number;
}

export class CsvTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvTooLargeError";
  }
}

const DEFAULT_MAX_ROWS = 20_000;
const DEFAULT_MAX_CELLS = 400_000;

/**
 * Parse CSV text into rows of raw strings. The header is row 0.
 *
 * A lone `"` inside an unquoted field is treated as literal rather than as the
 * start of a quoted section. Strict readers reject that; spreadsheet exports
 * contain it often enough (`5" single`) that rejecting the file over it would
 * be the wrong trade for an import tool.
 */
export function parseCsv(input: string, options: CsvParseOptions = {}): string[][] {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const maxCells = options.maxCells ?? DEFAULT_MAX_CELLS;

  // Excel and Exportify both emit a BOM; left in place it corrupts the first
  // header name, which then fails to match and looks like a missing column.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let cells = 0;

  const endField = () => {
    row.push(field);
    field = "";
    if (++cells > maxCells) {
      throw new CsvTooLargeError(`CSV has more than ${maxCells} cells.`);
    }
  };

  const endRow = () => {
    endField();
    // A trailing newline produces a final row of one empty field; that is an
    // artefact of the format rather than data.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    if (rows.length > maxRows) {
      throw new CsvTooLargeError(`CSV has more than ${maxRows} rows.`);
    }
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n") {
      endRow();
    } else if (char === "\r") {
      // CRLF: the \n does the work. A lone CR is an old Mac line ending.
      if (text[i + 1] === "\n") continue;
      endRow();
    } else {
      field += char;
    }
  }

  // Whatever is left when the input ends is a final row, unless the file ended
  // on a newline and left nothing behind.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

/**
 * Index a header row by normalised name, so `Track URI`, `track uri` and
 * `Track  URI` all resolve. Callers look columns up by the canonical spelling.
 */
export function headerIndex(header: string[]): Map<string, number> {
  const index = new Map<string, number>();
  header.forEach((name, i) => {
    const key = name.trim().replace(/\s+/g, " ").toLowerCase();
    // First occurrence wins: a duplicated column is a defect, and silently
    // preferring the later one would be arbitrary.
    if (key && !index.has(key)) index.set(key, i);
  });
  return index;
}
