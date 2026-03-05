import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Strip HTML tags from a string and decode HTML entities
 * Useful for displaying HTML content as plain text in previews
 */
export function stripHtml(html: string): string {
  if (!html) return '';

  // Create a temporary div to parse HTML
  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  // Get text content (this automatically strips all HTML tags)
  const text = tmp.textContent || tmp.innerText || '';

  // Trim whitespace and collapse multiple spaces
  return text.trim().replace(/\s+/g, ' ');
}
