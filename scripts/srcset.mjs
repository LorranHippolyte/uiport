import parseSrcset from "parse-srcset";

// parse-srcset reports invalid descriptors through console.log. That would
// print source page content and break the one-document stdout contract, so
// the diagnostic is suppressed here and reported by the caller instead.
export function parseSrcsetAttribute(value) {
  const log = console.log;
  console.log = () => {};
  try {
    return parseSrcset(value);
  } finally {
    console.log = log;
  }
}
