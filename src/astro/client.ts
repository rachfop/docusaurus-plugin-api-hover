/**
 * Browser entry injected on every page by the apiHover() Astro
 * integration. Imports the plugin styles, reads the integration options
 * from the virtual module the integration's Vite plugin resolves, and
 * boots the annotation + hover runtime.
 *
 * The styles load through `?inline` (Vite returns the compiled CSS text)
 * and are injected as a <style> element at runtime. Astro links CSS
 * chunks for the entries it manages, but a script added with
 * injectScript sits outside that graph: in the production build the
 * side-effect CSS imports land in a chunk no page ever references.
 */
import config from 'virtual:api-hover/config';
import baseStyles from '../theme/styles.css?inline';
import themeStyles from './theme.css?inline';
import { initApiHover } from './runtime';

function ensureStyles(): void {
  // Astro's view transitions swap head elements wholesale: a style that
  // exists only in the rendered page's head (like this one) is removed on
  // the first client-side navigation. astro:page-load fires after every
  // swap, so the styles survive navigation.
  if (document.querySelector('style[data-api-hover]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-api-hover', '');
  style.textContent = `${baseStyles}\n${themeStyles}`;
  document.head.append(style);
}

ensureStyles();
// Dispatched on document by Astro's view transitions; it does not bubble,
// so a window listener would never see it.
document.addEventListener('astro:page-load', ensureStyles);

void initApiHover(config);
