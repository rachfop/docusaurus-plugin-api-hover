/** The standalone bundle imports the stylesheet as text (esbuild's text loader). */
declare module '*.css' {
  const css: string;
  export default css;
}
