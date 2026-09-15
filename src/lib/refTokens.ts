// Shared between the studio prompt editor (chip highlighting) and
// /api/studio/generate (prompt rewriting) so both agree on what counts
// as a reference mention.
//
// Matches a standalone 1–2 digit number, optionally prefixed with '#':
// "texture 4", "#12", "a world full of 8" — but not "8m", "v8", or "123".

export const REF_TOKEN_SOURCE = "(?<![\\w#])#?(\\d{1,2})(?!\\w)";

export function makeRefTokenRegex(): RegExp {
    return new RegExp(REF_TOKEN_SOURCE, "g");
}
