/**
 * HTML Sanitization utilities
 * Use these functions when you need to render user-provided or external HTML
 */

/**
 * Strip all HTML tags from a string, keeping only text content.
 * Use this as the default approach for displaying external text.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  // Replace tags with space, then collapse multiple spaces
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escape HTML special characters to prevent XSS when inserting into HTML context.
 * Use this when you need to display user input as-is (not rendered as HTML).
 */
export function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Basic allowlist-based HTML sanitizer.
 * Only allows a small set of safe formatting tags.
 * For complex HTML, consider using DOMPurify library instead.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  
  // Allowlisted tags (self-closing and pairs)
  const allowedTags = ['b', 'i', 'u', 'strong', 'em', 'br', 'p', 'ul', 'ol', 'li', 'span'];
  
  let result = String(html);
  
  // Remove script, style, and event handlers completely
  result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  result = result.replace(/\son\w+\s*=/gi, ' data-removed=');
  result = result.replace(/javascript:/gi, '');
  
  // Remove disallowed tags but keep their content
  // This is a simple implementation - for production, use DOMPurify
  const tagRegex = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
  result = result.replace(tagRegex, (match, tagName) => {
    const tag = tagName.toLowerCase();
    if (allowedTags.includes(tag)) {
      // For allowed tags, strip attributes except basic ones
      if (match.startsWith('</')) {
        return `</${tag}>`;
      }
      // Self-closing br
      if (tag === 'br') {
        return '<br />';
      }
      return `<${tag}>`;
    }
    return ''; // Remove disallowed tags
  });
  
  return result;
}

/**
 * Truncate text to a maximum length, adding ellipsis if needed.
 */
export function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return '';
  const str = String(text);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Safe URL validator - only allows http, https, and mailto protocols.
 * Returns empty string for invalid/dangerous URLs.
 */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return '';
  const str = String(url).trim();
  
  // Check for safe protocols
  if (/^https?:\/\//i.test(str) || /^mailto:/i.test(str)) {
    return str;
  }
  
  // Relative URLs are allowed
  if (str.startsWith('/') && !str.startsWith('//')) {
    return str;
  }
  
  // Block everything else (javascript:, data:, vbscript:, etc.)
  return '';
}
