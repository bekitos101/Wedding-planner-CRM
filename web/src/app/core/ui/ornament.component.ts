import { Component } from '@angular/core';

/** Decorative backdrop (soft blobs + botanical line art) used instead of photos. */
@Component({
  selector: 'app-ornament',
  template: `
    <svg class="h-full w-full" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
      <circle cx="470" cy="130" r="210" fill="#f5ccd6" opacity="0.55" />
      <circle cx="120" cy="470" r="190" fill="#c9d8c6" opacity="0.5" />
      <circle cx="300" cy="300" r="120" fill="#fbe6ea" opacity="0.7" />
      <g stroke="#8f2a47" stroke-width="2" stroke-linecap="round" opacity="0.55">
        <circle cx="262" cy="320" r="64" />
        <circle cx="338" cy="320" r="64" stroke="#4a6249" />
      </g>
      <g stroke="#4a6249" stroke-width="2" stroke-linecap="round" opacity="0.45">
        <path d="M60 560C90 440 130 380 210 330" />
        <path d="M110 470c-30-6-48-24-56-48 26 2 46 16 56 48z" />
        <path d="M150 410c-26 8-50 2-68-16 26-8 50-4 68 16z" />
        <path d="M540 40C510 160 470 220 390 270" />
        <path d="M490 130c30 6 48 24 56 48-26-2-46-16-56-48z" />
        <path d="M450 190c26-8 50-2 68 16-26 8-50 4-68-16z" />
      </g>
    </svg>
  `,
  host: { class: 'block overflow-hidden', 'aria-hidden': 'true' },
})
export class OrnamentComponent {}
