// The guide is bundled as a string (wrangler.jsonc "rules": Text for .md).
declare module '*.md' {
  const text: string;
  export default text;
}
