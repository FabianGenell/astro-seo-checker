import { defineConfig } from 'astro/config';
import astroSeoChecker from 'astro-seo-checker';

export default defineConfig({
  redirects: {
    '/redirected': '/about',
  },
  integrations: [astroSeoChecker({
    logFilePath: 'site-report.log',  // Single consolidated log file
    checkExternalLinks: false,      // Disable external link checking for faster tests
    emailAllowlist: ['allowlisted@example.com'],
    phases: {
      foundation: true, // Enable Foundation & Privacy
      metadata: true, // Enable Metadata & Semantic Structure
      accessibility: true, // Enable Accessibility & UX Flags
      performance: true, // Enable Performance & Technical SEO
      crawlability: true, // Enable Crawlability & Linking
      ai_detection: true, // Enable AI Content Detection
    },
    checkCanonical: true, // Enable canonical link checking
    ignoreEmptyAlt: true, // Don't flag empty alt attributes (they might be intentional for decorative images),
    checkResourceSizes: true, // Enable resource size checking in Phase 4
    inlineScriptThreshold: 2, // KB threshold for inline scripts
    inlineStyleThreshold: 1, // KB threshold for inline styles
    imageSizeThreshold: 200, // KB threshold for image size warnings
    aiDetectionThreshold: 50, // Lower threshold for AI detection in tests
  })],
});