import { fileURLToPath } from 'url';
import path, { join } from 'path';
import fs from 'fs';
import { normalizeHtmlFilePath } from './src/phases/utils.js';
import { runPhases, phases } from './src/phases/index.js';
import { formatReport, OUTPUT_FORMATS } from './src/formatters/index.js';
import fastGlob from 'fast-glob';

/**
 * Configuration options for the Astro SEO Checker integration
 *
 * @typedef {Object} AstroSeoCheckerOptions
 *
 * @property {string} [reportFilePath='site-report.log'] - Path where the report file will be saved. Extension determines format unless overridden
 * @property {string} [logFilePath] - Legacy alias for reportFilePath, maintained for backward compatibility
 * @property {string} [reportFormat] - Report format override ('markdown', 'json', 'csv') regardless of file extension
 * @property {boolean} [checkExternalLinks=false] - Whether to check external links (significantly slower)
 * @property {boolean} [verbose=false] - Enable detailed logging during the scan process
 *
 * @property {string[]} [emailAllowlist=[]] - List of email addresses to ignore when checking for exposed emails
 * @property {boolean} [checkCanonical=true] - Validate the canonical link on each page
 *
 * @property {Object} [phases] - Enable/disable specific check phases
 * @property {boolean} [phases.foundation=true] - Foundation & Privacy checks
 * @property {boolean} [phases.metadata=true] - Metadata & Semantic Structure checks
 * @property {boolean} [phases.accessibility=true] - Accessibility & UX Flags checks
 * @property {boolean} [phases.performance=true] - Performance & Technical SEO checks
 * @property {boolean} [phases.crawlability=true] - Crawlability & Linking checks
 * @property {boolean} [phases.ai_detection=true] - AI Content Detection checks
 *
 * @property {boolean} [ignoreEmptyAlt=false] - Don't flag empty alt attributes (for decorative images)
 *
 * @property {boolean} [checkResourceSizes=false] - Enable file size checking for resources
 * @property {number} [imageSizeThreshold=200] - Size threshold for images in KB (flags larger images)
 * @property {number} [inlineScriptThreshold=2] - Size threshold for inline scripts in KB (flags larger scripts)
 * @property {number} [inlineStyleThreshold=1] - Size threshold for inline styles in KB (flags larger styles)
 *
 * @property {number} [minInternalLinks=3] - Minimum recommended internal links per page
 * @property {number} [maxInternalLinks=100] - Maximum recommended internal links per page
 *
 * @property {number} [aiDetectionThreshold=60] - Score threshold (0-100) for flagging AI content
 * @property {string[]} [aiDetectionExcludePaths=[]] - Paths to exclude from AI detection
 */

/**
 * Astro SEO Checker integration main function
 *
 * @param {AstroSeoCheckerOptions} options - Configuration options
 */
export default function astroBrokenLinksChecker(options = {}) {
  // Default options
  const reportFilePath = options.reportFilePath || options.logFilePath || 'site-report.log';
  const reportFormat = options.reportFormat; // Auto-detected from file extension if not specified
  const brokenLinksMap = new Map(); // Map of brokenLink -> Set of documents
  const checkedLinks = new Map();
  const seoIssuesMap = new Map(); // Map of category -> Map of issue -> Set of documents

  // Configure phases from options
  if (options.phases) {
    for (const [phaseId, enabled] of Object.entries(options.phases)) {
      if (phases[phaseId]) {
        phases[phaseId].enabled = enabled;
      }
    }
  }

  // Configure email allowlist
  options.emailAllowlist = options.emailAllowlist || [];

  return {
    name: 'astro-seo-checker',
    hooks: {
      'astro:config:setup': async ({ config }) => {
        // Save the redirects to the options
        options.astroConfigRedirects = config.redirects;
      },
      
      'astro:build:done': async ({ dir, logger }) => {
        const astroConfigRedirects = options.astroConfigRedirects;
        const distPath = fileURLToPath(dir);
        const htmlFiles = await fastGlob('**/*.html', { cwd: distPath });

        // Count enabled phases for better progress reporting
        const enabledPhases = Object.values(phases).filter(phase => phase.enabled).length;

        logger.info(`
🔍 Starting SEO check on ${htmlFiles.length} HTML pages
   Running ${enabledPhases} enabled phases: ${Object.values(phases)
     .filter(phase => phase.enabled)
     .map(phase => phase.name)
     .join(', ')}
        `);

        // Start time
        const startTime = Date.now();

        // Resolve report file path to absolute path in the output directory
        const absoluteReportFilePath = join(distPath, reportFilePath);

        // Track progress for large projects
        let pagesProcessed = 0;
        const totalPages = htmlFiles.length;

        const checkHtmlPromises = htmlFiles.map(async (htmlFile) => {
          const absoluteHtmlFilePath = join(distPath, htmlFile);
          const htmlContent = fs.readFileSync(absoluteHtmlFilePath, 'utf8');
          const baseUrl = normalizeHtmlFilePath(absoluteHtmlFilePath, distPath);

          // Set up options for the phase runner with links checking
          const phaseOptions = {
            ...options,
            brokenLinksMap,
            checkedLinks,
            astroConfigRedirects,
            logger,
            // Only enable verbose logging if specifically requested
            verbose: options.verbose || false
          };

          // Run SEO check phases (including link checking in Foundation phase)
          await runPhases(
            htmlContent,
            seoIssuesMap,
            baseUrl,
            absoluteHtmlFilePath,
            distPath,
            phaseOptions,
            logger
          );

          // Update progress
          pagesProcessed++;

          // For large sites (>50 pages), show periodic progress
          if (totalPages > 50 && pagesProcessed % 10 === 0) {
            const percent = Math.round((pagesProcessed / totalPages) * 100);
            logger.info(`   Progress: ${percent}% (${pagesProcessed}/${totalPages} pages scanned)`);
          }
        });
        
        await Promise.all(checkHtmlPromises);
        
        // Generate and write report
        generateReport(
          brokenLinksMap,
          seoIssuesMap,
          {
            filePath: absoluteReportFilePath,
            format: reportFormat,
            startTime: startTime
          },
          logger
        );
      },
    },
  };
}

/**
 * Generate report and write to filesystem
 *
 * @param {Map} brokenLinksMap - Map of broken links to affected pages
 * @param {Map} seoIssuesMap - Map of SEO issues by category
 * @param {Object} options - Report options
 * @param {string} options.filePath - Path to write the report
 * @param {string} [options.format] - Optional format override
 * @param {number} options.startTime - Scan start time timestamp
 * @param {Object} logger - Astro logger instance
 */
function generateReport(brokenLinksMap, seoIssuesMap, options, logger) {
  // Calculate elapsed time
  const endTime = Date.now();
  const elapsedTime = (endTime - options.startTime) / 1000;

  // Format report using the appropriate formatter
  const reportData = formatReport(brokenLinksMap, seoIssuesMap, options);

  // Count totals for console summary
  const brokenLinkCount = brokenLinksMap.size;
  let totalSeoIssues = 0;
  const issueCategories = [];

  for (const [category, issuesMap] of seoIssuesMap.entries()) {
    totalSeoIssues += issuesMap.size;
    issueCategories.push(`${issuesMap.size} ${category}`);
  }

  // Write the report to file if file path is provided
  if (options.filePath) {
    // Ensure directory exists
    const reportDir = path.dirname(options.filePath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(options.filePath, reportData, 'utf8');

    // Log summary to console
    const format = options.format || path.extname(options.filePath).substring(1) || 'log';
    const formatName = format.toUpperCase();

    // Group categories by type for better organization
    const categoryGroups = {
      performance: [],
      accessibility: [],
      metadata: [],
      semantic: [],
      crawlability: [],
      linking: [],
      content: [],
      privacy: [],
      technical: []
    };

    // Sort issues into category groups
    for (const category of issueCategories) {
      const [count, ...parts] = category.split(' ');
      const categoryString = parts.join(' ');

      // Find which group this belongs to
      for (const groupName of Object.keys(categoryGroups)) {
        if (categoryString.startsWith(groupName)) {
          categoryGroups[groupName].push({ count: parseInt(count, 10), category: categoryString });
          break;
        }
      }
    }

    // Generate category output with colors
    let categoriesByGroup = '';

    if (issueCategories.length > 0) {
      // First add high-level summary by group
      categoriesByGroup = '\n\n  Issue breakdown:';

      // Sort groups by priority for display
      const groupDisplayOrder = [
        'performance', 'accessibility', 'metadata',
        'crawlability', 'linking', 'technical',
        'content', 'privacy', 'semantic'
      ];

      // Add emojis for each group
      const groupEmojis = {
        performance: '⚡',
        accessibility: '♿',
        metadata: '📄',
        crawlability: '🔍',
        linking: '🔗',
        technical: '🔧',
        content: '📝',
        privacy: '🔒',
        semantic: '🏗️'
      };

      // Format the category groups for display
      for (const group of groupDisplayOrder) {
        const issues = categoryGroups[group];
        if (issues.length > 0) {
          // Calculate total issues in this group
          const totalInGroup = issues.reduce((sum, issue) => sum + issue.count, 0);

          // Add group header
          categoriesByGroup += `\n    ${groupEmojis[group]} ${group[0].toUpperCase() + group.slice(1)}: ${totalInGroup} issue${totalInGroup !== 1 ? 's' : ''}`;

          // Sort issues within the group by count (descending)
          issues.sort((a, b) => b.count - a.count);

          // Add each issue in the group
          for (const { count, category } of issues) {
            // Extract the specific issue type from the category
            const issueType = category.split(': ')[1] || category;
            categoriesByGroup += `\n      • ${issueType}: ${count}`;
          }
        }
      }
    }

    const summaryForConsole = `
✨ Astro SEO Checker Report ✨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Scan completed in ${elapsedTime.toFixed(2)} seconds

📊 Summary:
  ${brokenLinkCount > 0 ? `⚠️  ${brokenLinkCount} broken link${brokenLinkCount !== 1 ? 's' : ''}` : '✅ No broken links detected'}
  ${totalSeoIssues > 0 ? `⚠️  ${totalSeoIssues} SEO issue${totalSeoIssues !== 1 ? 's' : ''}` : '✅ No SEO issues detected'}${categoriesByGroup}

📄 Full ${formatName} report written to:
  ${options.filePath}
`;

    logger.info(summaryForConsole);
  } else {
    // If no file path, just log the report directly
    logger.info(reportData);
  }
}


