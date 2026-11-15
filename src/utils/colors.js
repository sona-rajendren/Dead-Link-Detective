/**
 * Tiny ANSI colour helper (no dependency needed).
 * Colours switch off automatically when output is piped to a file, when
 * NO_COLOR is set, or when the user passes --no-color.
 */
const CODES = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  gray: [90, 39],
};

export function shouldUseColor(stream = process.stdout, flagDisabled = false) {
  if (flagDisabled || process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(stream.isTTY);
}

export function createColors(enabled) {
  const paint = (name) => (text) => {
    const [open, close] = CODES[name];
    return enabled ? `\u001b[${open}m${text}\u001b[${close}m` : String(text);
  };
  return Object.fromEntries(Object.keys(CODES).map((name) => [name, paint(name)]));
}
