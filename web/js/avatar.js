/**
 * Felt-style Avatar Generator
 * Creates SVG avatars with a handmade felt aesthetic
 *
 * This is a wrapper that handles both old (button-based) and new (shape-based) avatar formats
 */

import { generateAvatarFromShapes } from './avatar-editor.js';

/**
 * Generate an SVG avatar based on configuration
 * Supports both old format (config object) and new format (shapes array)
 * @param {Object} config - Avatar configuration
 * @returns {string} SVG string
 */
export function generateAvatar(config = {}) {
    // New format: shapes array
    if (config.shapes && Array.isArray(config.shapes)) {
        return generateAvatarFromShapes(config.shapes, null, config.bgColor || '#E8F4F8');
    }

    // Old format: fall back to placeholder or simple rendering
    return generateLegacyAvatar(config);
}

/**
 * Generate avatar using old button-based format (for backward compatibility)
 */
function generateLegacyAvatar(config = {}) {
    // Default configuration
    const defaults = {
        faceShape: 'oval',
        faceColor: '#FFD5A5',
        eyes: 'dots',
        eyeColor: '#2C1810',
        mouth: 'smile',
        mouthColor: '#8B4513',
        hair: 'short',
        hairColor: '#4A2511',
        bgColor: '#E8F4F8'
    };

    const cfg = { ...defaults, ...config };

    // SVG container (200x200 viewBox)
    const svgParts = [];

    // Background circle (felt texture base)
    svgParts.push(`<circle cx="100" cy="100" r="95" fill="${cfg.bgColor}"/>`);

    // Face shape - oval for now
    svgParts.push(renderFace(cfg));

    // Eyes
    svgParts.push(renderEyes(cfg));

    // Mouth
    svgParts.push(renderMouth(cfg));

    // Hair (on top layer)
    svgParts.push(renderHair(cfg));

    return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        ${svgParts.join('\n        ')}
    </svg>`;
}

/**
 * Render face shape
 */
function renderFace(cfg) {
    // Simple oval face - centered at 100,100
    return `<ellipse cx="100" cy="100" rx="60" ry="70" fill="${cfg.faceColor}" stroke="${darken(cfg.faceColor, 0.1)}" stroke-width="1"/>`;
}

/**
 * Render eyes based on style
 */
function renderEyes(cfg) {
    const parts = [];

    if (cfg.eyes === 'dots') {
        // Simple dot eyes
        parts.push(`<circle cx="80" cy="90" r="5" fill="${cfg.eyeColor}"/>`);
        parts.push(`<circle cx="120" cy="90" r="5" fill="${cfg.eyeColor}"/>`);
    } else if (cfg.eyes === 'circles') {
        // Bigger circle eyes
        parts.push(`<circle cx="80" cy="90" r="8" fill="${cfg.eyeColor}"/>`);
        parts.push(`<circle cx="120" cy="90" r="8" fill="${cfg.eyeColor}"/>`);
    } else if (cfg.eyes === 'closed') {
        // Simple lines for closed eyes
        parts.push(`<line x1="75" y1="90" x2="85" y2="90" stroke="${cfg.eyeColor}" stroke-width="3" stroke-linecap="round"/>`);
        parts.push(`<line x1="115" y1="90" x2="125" y2="90" stroke="${cfg.eyeColor}" stroke-width="3" stroke-linecap="round"/>`);
    }

    return parts.join('\n        ');
}

/**
 * Render mouth based on style
 */
function renderMouth(cfg) {
    if (cfg.mouth === 'smile') {
        // Simple curved smile
        return `<path d="M 80 120 Q 100 130 120 120" stroke="${cfg.mouthColor}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    } else if (cfg.mouth === 'straight') {
        // Straight line mouth
        return `<line x1="80" y1="120" x2="120" y2="120" stroke="${cfg.mouthColor}" stroke-width="3" stroke-linecap="round"/>`;
    } else if (cfg.mouth === 'frown') {
        // Frown
        return `<path d="M 80 125 Q 100 115 120 125" stroke="${cfg.mouthColor}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    }
    return '';
}

/**
 * Render hair based on style
 */
function renderHair(cfg) {
    const parts = [];

    if (cfg.hair === 'short') {
        // Simple top tuft
        parts.push(`<ellipse cx="100" cy="50" rx="50" ry="30" fill="${cfg.hairColor}" stroke="${darken(cfg.hairColor, 0.1)}" stroke-width="1"/>`);
    } else if (cfg.hair === 'long') {
        // Longer hair on sides
        parts.push(`<ellipse cx="100" cy="50" rx="55" ry="35" fill="${cfg.hairColor}" stroke="${darken(cfg.hairColor, 0.1)}" stroke-width="1"/>`);
        parts.push(`<ellipse cx="60" cy="80" rx="15" ry="30" fill="${cfg.hairColor}" stroke="${darken(cfg.hairColor, 0.1)}" stroke-width="1"/>`);
        parts.push(`<ellipse cx="140" cy="80" rx="15" ry="30" fill="${cfg.hairColor}" stroke="${darken(cfg.hairColor, 0.1)}" stroke-width="1"/>`);
    } else if (cfg.hair === 'bald') {
        // No hair!
        return '';
    }

    return parts.join('\n        ');
}

/**
 * Darken a hex color by a percentage
 */
function darken(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const r = Math.max(0, Math.floor((num >> 16) * (1 - percent)));
    const g = Math.max(0, Math.floor(((num >> 8) & 0x00FF) * (1 - percent)));
    const b = Math.max(0, Math.floor((num & 0x0000FF) * (1 - percent)));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Get available options for each component
 */
export function getAvatarOptions() {
    return {
        eyes: ['dots', 'circles', 'closed'],
        mouth: ['smile', 'straight', 'frown'],
        hair: ['short', 'long', 'bald'],
        faceColor: ['#FFD5A5', '#F4C2A0', '#D9A679', '#C68E6E', '#8D5524'],
        hairColor: ['#4A2511', '#8B4513', '#D2691E', '#FFD700', '#FF6347', '#4B0082'],
        bgColor: ['#E8F4F8', '#FFE8E8', '#E8FFE8', '#FFF8E8', '#F0E8FF']
    };
}
