// Surfaces describe the actual header backdrop, independent of destination/content IDs.
export const primaryHeaderSurfaces = Object.freeze({
  Home: 'dark-media', Itinerary: 'light', Explore: 'dark', Budget: 'light', Info: 'light'
});

export function updateHeaderSurface(header, surface) {
  const safeSurface = ['light', 'dark', 'dark-media'].includes(surface) ? surface : 'light';
  header.dataset.surface = safeSurface;
  header.ownerDocument.documentElement.dataset.headerLayout = safeSurface === 'dark-media' ? 'cover' : 'flow';
  // Resolve from the stable shell URL, also under a GitHub Pages deployment subpath.
  header.style.setProperty('--header-logo', `url("${header.querySelector('img').src}")`);
}
