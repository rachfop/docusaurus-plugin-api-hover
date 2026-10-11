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

if (!document.querySelector('style[data-api-hover]')) {
  const style = document.createElement('style');
  style.setAttribute('data-api-hover', '');
  style.textContent = `${baseStyles}\n${themeStyles}`;
  document.head.append(style);
}

void initApiHover(config);
