/**
 * Felt-style Avatar Editor
 * Drag-and-drop SVG editor for creating custom avatars
 */

/**
 * Get the next available integer ID for a new shape
 * Finds the lowest unused integer by checking existing shapes
 */
export function getNextShapeId(existingShapes) {
    if (!existingShapes || existingShapes.length === 0) {
        return 1;
    }

    const usedIds = new Set(existingShapes.map(s => s.id));
    let nextId = 1;
    while (usedIds.has(nextId)) {
        nextId++;
    }
    return nextId;
}

// Available shape types in the palette with fun default colors
// WARNING: If you modify SHAPE_PALETTE default colors, make sure all colors
// are included in the COLORS array below so users can select them!
export const SHAPE_PALETTE = {
    ellipse: { name: 'Oval', color: '#FFD5A5' },         // Skin tone (face)
    circle: { name: 'Circle', color: '#FF69B4' },        // Hot pink
    rectangle: { name: 'Rectangle', color: '#87CEEB' },  // Sky blue
    bodyRounded: { name: 'Body', color: '#98FB98' },     // Pale green
    bodyNarrow: { name: 'Body (Narrow)', color: '#DDA0DD' }, // Plum
    bodyWide: { name: 'Body (Wide)', color: '#F0E68C' }, // Khaki
    eye: { name: 'Eye', color: '#2C1810' },              // Dark brown/black
    straight: { name: 'Straight', color: '#2C1810' },    // Dark brown/black (mouth/eye)
    smile: { name: 'Smile', color: '#2C1810' }           // Dark brown/black (mouth)
};

// Color palette available to users for customization
// WARNING: This MUST include all default colors from SHAPE_PALETTE above!
// Current defaults: #FF69B4, #FFD5A5, #87CEEB, #98FB98, #DDA0DD, #F0E68C, #2C1810
export const COLORS = [
    '#FFD5A5', '#F4C2A0', '#D9A679', '#C68E6E', '#8D5524', // Skin tones
    '#2C1810', '#4A2511', '#8B4513', '#D2691E', '#FFD700', '#FF6347', '#4B0082', // Dark brown + hair colors
    '#E8F4F8', '#FFE8E8', '#E8FFE8', '#FFF8E8', '#F0E8FF', // Pastels
    '#FF69B4', '#87CEEB', '#98FB98', '#DDA0DD', '#F0E68C'  // Bright colors (shape defaults)
];

// Background color palette
export const BG_COLORS = [
    '#E8F4F8', // Light blue (default)
    '#FFE8E8', // Light pink
    '#E8FFE8', // Light green
    '#FFF8E8', // Light yellow
    '#F0E8FF', // Light purple
    '#FFFFFF', // White
    '#F5F5F5', // Light gray
    '#FFF0E0', // Peach
    '#E0F0FF', // Sky blue
    '#FFE0F0'  // Rose
];

/**
 * Create a new shape object
 * @param {string} type - Shape type
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {string} color - Color
 * @param {number} id - Optional ID (if not provided, must be set by caller)
 */
export function createShape(type, x = 100, y = 100, color = null, id = null) {
    const baseShape = {
        id: id, // ID will be set by caller using getNextShapeId
        type,
        x,
        y,
        color: color || SHAPE_PALETTE[type]?.color || '#FFD5A5',
        rotation: 0
    };

    // Add type-specific properties
    switch (type) {
        case 'circle':
        case 'eye':
            return { ...baseShape, r: 20 };
        case 'ellipse':
            return { ...baseShape, rx: 25, ry: 20 };
        case 'rectangle':
            return { ...baseShape, width: 40, height: 50 };
        case 'bodyRounded':
        case 'bodyNarrow':
        case 'bodyWide':
            return { ...baseShape, width: 60, height: 80 };
        case 'straight':
            return { ...baseShape, width: 30, height: 4 }; // Horizontal pill (can be thinned for eyes)
        case 'smile':
            return { ...baseShape, width: 30, height: 15 }; // Arc dimensions
        default:
            return baseShape;
    }
}

/**
 * Render a single shape to SVG
 */
export function renderShape(shape, isSelected = false) {
    const parts = [];
    const transform = shape.rotation ? `rotate(${shape.rotation} ${shape.x} ${shape.y})` : '';

    switch (shape.type) {
        case 'circle':
        case 'eye':
            parts.push(`<circle cx="${shape.x}" cy="${shape.y}" r="${shape.r}" fill="${shape.color}" transform="${transform}" data-shape-id="${shape.id}"/>`);
            break;

        case 'ellipse':
            parts.push(`<ellipse cx="${shape.x}" cy="${shape.y}" rx="${shape.rx}" ry="${shape.ry}" fill="${shape.color}" transform="${transform}" data-shape-id="${shape.id}"/>`);
            break;

        case 'rectangle':
            const rx = shape.x - shape.width / 2;
            const ry = shape.y - shape.height / 2;
            parts.push(`<rect x="${rx}" y="${ry}" width="${shape.width}" height="${shape.height}" rx="5" fill="${shape.color}" transform="${transform}" data-shape-id="${shape.id}"/>`);
            break;

        case 'bodyRounded':
            parts.push(renderBodyRounded(shape));
            break;

        case 'bodyNarrow':
            parts.push(renderBodyNarrow(shape));
            break;

        case 'bodyWide':
            parts.push(renderBodyWide(shape));
            break;

        case 'straight':
            parts.push(renderStraight(shape));
            break;

        case 'smile':
            parts.push(renderSmile(shape));
            break;
    }

    // Selection handles
    if (isSelected) {
        parts.push(renderSelectionHandles(shape));
    }

    return parts.join('\n');
}

/**
 * Render body with rounded top
 */
function renderBodyRounded(shape) {
    const w = shape.width;
    const h = shape.height;
    const x = shape.x - w / 2;
    const y = shape.y - h / 2;
    const transform = shape.rotation ? `rotate(${shape.rotation} ${shape.x} ${shape.y})` : '';

    // Path: rounded top, straight sides, flat bottom
    const path = `M ${x} ${y + h * 0.3} Q ${x} ${y} ${x + w * 0.5} ${y} Q ${x + w} ${y} ${x + w} ${y + h * 0.3} L ${x + w} ${y + h} L ${x} ${y + h} Z`;

    return `<path d="${path}" fill="${shape.color}" transform="${transform}" data-shape-id="${shape.id}"/>`;
}

/**
 * Render body that narrows at bottom
 */
function renderBodyNarrow(shape) {
    const w = shape.width;
    const h = shape.height;
    const x = shape.x - w / 2;
    const y = shape.y - h / 2;
    const narrowAmount = w * 0.15;
    const transform = shape.rotation ? `rotate(${shape.rotation} ${shape.x} ${shape.y})` : '';

    // Path: rounded top, narrows toward bottom
    const path = `M ${x} ${y + h * 0.3} Q ${x} ${y} ${x + w * 0.5} ${y} Q ${x + w} ${y} ${x + w} ${y + h * 0.3} L ${x + w - narrowAmount} ${y + h} L ${x + narrowAmount} ${y + h} Z`;

    return `<path d="${path}" fill="${shape.color}" transform="${transform}" data-shape-id="${shape.id}"/>`;
}

/**
 * Render body that widens at bottom
 */
function renderBodyWide(shape) {
    const w = shape.width;
    const h = shape.height;
    const x = shape.x - w / 2;
    const y = shape.y - h / 2;
    const widenAmount = w * 0.15;
    const transform = shape.rotation ? `rotate(${shape.rotation} ${shape.x} ${shape.y})` : '';

    // Path: rounded top, widens toward bottom
    const path = `M ${x} ${y + h * 0.3} Q ${x} ${y} ${x + w * 0.5} ${y} Q ${x + w} ${y} ${x + w} ${y + h * 0.3} L ${x + w + widenAmount} ${y + h} L ${x - widenAmount} ${y + h} Z`;

    return `<path d="${path}" fill="${shape.color}" transform="${transform}" data-shape-id="${shape.id}"/>`;
}

/**
 * Render straight line (horizontal pill/capsule for mouth/eye)
 */
function renderStraight(shape) {
    const w = shape.width;
    const h = shape.height;
    const x = shape.x - w / 2;
    const y = shape.y - h / 2;
    const transform = shape.rotation ? `rotate(${shape.rotation} ${shape.x} ${shape.y})` : '';

    // Rounded rectangle (pill shape)
    const radius = h / 2;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${shape.color}" transform="${transform}" data-shape-id="${shape.id}"/>`;
}

/**
 * Render smile (curved arc for mouth)
 */
function renderSmile(shape) {
    const w = shape.width;
    const h = shape.height;
    const transform = shape.rotation ? `rotate(${shape.rotation} ${shape.x} ${shape.y})` : '';

    // Arc path for smile
    // Start at left side, curve down and to the right
    const startX = shape.x - w / 2;
    const startY = shape.y;
    const endX = shape.x + w / 2;
    const endY = shape.y;

    // Quadratic curve with control point below
    const controlX = shape.x;
    const controlY = shape.y + h;

    const path = `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;

    // Stroke width scales with height but has a minimum
    const strokeWidth = Math.max(1, h * 0.2);

    return `<path d="${path}" fill="none" stroke="${shape.color}" stroke-width="${strokeWidth}" stroke-linecap="round" transform="${transform}" data-shape-id="${shape.id}"/>`;
}

/**
 * Render selection handles
 */
function renderSelectionHandles(shape) {
    const parts = [];

    // Calculate handle positions at the actual edges/corners of the shape
    let resizeOffsetX, resizeOffsetY, rotateOffsetX, rotateOffsetY;

    // Position handles at actual shape boundaries
    if (shape.type === 'circle' || shape.type === 'eye') {
        // For circles, place handle at 45 degrees from center at radius distance
        const offset = shape.r;
        resizeOffsetX = offset * Math.SQRT1_2; // cos(45°) * r
        resizeOffsetY = offset * Math.SQRT1_2; // sin(45°) * r
        rotateOffsetX = offset * Math.SQRT1_2;
        rotateOffsetY = -offset * Math.SQRT1_2;
    } else if (shape.type === 'ellipse') {
        // For ellipses, place handle at the actual corner of bounding box
        resizeOffsetX = shape.rx;
        resizeOffsetY = shape.ry;
        rotateOffsetX = shape.rx;
        rotateOffsetY = -shape.ry;
    } else if (shape.width && shape.height) {
        // For rectangles and other shapes with width/height, place at actual corner
        resizeOffsetX = shape.width / 2;
        resizeOffsetY = shape.height / 2;
        rotateOffsetX = shape.width / 2;
        rotateOffsetY = -shape.height / 2;
    } else {
        // Fallback
        resizeOffsetX = 30;
        resizeOffsetY = 30;
        rotateOffsetX = 30;
        rotateOffsetY = -30;
    }

    const rotation = shape.rotation || 0;
    const transform = `rotate(${rotation} ${shape.x} ${shape.y})`;

    // Bottom-right: resize handle (square) - at the actual corner/edge
    const resizeX = shape.x + resizeOffsetX;
    const resizeY = shape.y + resizeOffsetY;
    parts.push(`<rect x="${resizeX - 4}" y="${resizeY - 4}" width="8" height="8" fill="white" stroke="#667eea" stroke-width="2" class="resize-handle" data-shape-id="${shape.id}" transform="${transform}"/>`);

    // Top-right: rotate handle (circle) - at the actual corner/edge
    const rotateX = shape.x + rotateOffsetX;
    const rotateY = shape.y + rotateOffsetY;
    parts.push(`<circle cx="${rotateX}" cy="${rotateY}" r="5" fill="white" stroke="#667eea" stroke-width="2" class="rotate-handle" data-shape-id="${shape.id}" transform="${transform}"/>`);

    return parts.join('\n');
}

/**
 * Generate complete avatar SVG from shapes array
 */
export function generateAvatarFromShapes(shapes, selectedShapeId = null, bgColor = '#E8F4F8') {
    // Sort shapes by z-index (if we add that) or just by order in array
    const sortedShapes = [...shapes];

    // Render all shapes first (without handles)
    const shapeSVGs = sortedShapes.map(shape => renderShape(shape, false));

    // Then render handles for selected shape on top of everything
    let handlesSVG = '';
    if (selectedShapeId !== null) {
        const selectedShape = sortedShapes.find(s => s.id === selectedShapeId);
        if (selectedShape) {
            handlesSVG = renderSelectionHandles(selectedShape);
        }
    }

    return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" class="avatar-canvas">
        <rect width="200" height="200" fill="${bgColor}"/>
        ${shapeSVGs.join('\n        ')}
        ${handlesSVG}
    </svg>`;
}

/**
 * Darken a hex color
 */
function darken(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const r = Math.max(0, Math.floor((num >> 16) * (1 - percent)));
    const g = Math.max(0, Math.floor(((num >> 8) & 0x00FF) * (1 - percent)));
    const b = Math.max(0, Math.floor((num & 0x0000FF) * (1 - percent)));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
