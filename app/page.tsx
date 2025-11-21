"use client";

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

type Status =
  | { state: "idle" }
  | { state: "uploading" }
  | { state: "error"; message: string }
  | { state: "success"; message: string };

type PreviewDetail = {
  code: string;
  description: string;
  size: string;
  price?: number;
};

type PreviewType = {
  type: string;
  label: string;
  materials: Record<string, string>;
  stats: {
    areaSqFt: number | null;
    costPerSqFt: number | null;
    total: number | null;
  };
  dimensionAggregate: number | null;
  items: PreviewDetail[];
};

type PreviewRoom = {
  name: string;
  types: PreviewType[];
};

type RoomSummaryRow = {
  room: string;
  modules: number;
  accessories: number;
  appliances: number;
  services: number;
  furniture: number;
  total?: number;
};

type QuoteSummary = {
  rows: RoomSummaryRow[];
  subtotal?: number;
  totalPayable?: number;
  discount?: number;
};

type QuoteMetadata = {
  reference?: string;
  customer?: string;
  designerName?: string;
  designerEmail?: string;
  designerPhone?: string;
  quoteDate?: string;
  quoteValidTill?: string;
  propertyName?: string;
  totalBuiltUpArea?: string;
  propertyConfig?: string;
  quoteStatus?: string;
  address?: string;
  quoteNumber?: string;
  discountAmount?: number;
};

const METADATA_FIELDS: Array<{
  field: keyof QuoteMetadata;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  fullWidth?: boolean;
}> = [
  { field: "quoteNumber", label: "Quote Number" },
  { field: "quoteDate", label: "Quote Date" },
  { field: "customer", label: "Customer Name" },
  { field: "propertyName", label: "Property Name" },
  { field: "totalBuiltUpArea", label: "Total Built-up Area" },
  { field: "propertyConfig", label: "Property Config" },
  { field: "designerName", label: "Design Expert" },
  { field: "designerEmail", label: "Designer Email" },
  { field: "designerPhone", label: "Designer Phone" },
  { field: "quoteValidTill", label: "Quote Valid Till" },
  { field: "quoteStatus", label: "Quote Status" },
  { field: "discountAmount", label: "Discount Amount (₹)" },
  { field: "address", label: "Address", multiline: true, fullWidth: true },
];

const PAYMENT_SCHEDULE = [
  { stage: "Design Start Stage", percentage: 10 },
  { stage: "Design Freeze Stage", percentage: 10 },
  { stage: "Production Start", percentage: 40 },
  { stage: "Before Dispatch", percentage: 30 },
  { stage: "Post Carcass", percentage: 10 },
] as const;

type PreviewContentProps = {
  meta: QuoteMetadata | null;
  rooms: PreviewRoom[];
  summary: QuoteSummary | null;
  formatNumber: Intl.NumberFormat;
  formatCurrency: Intl.NumberFormat;
  onMetaChange: (field: keyof QuoteMetadata, value: string) => void;
  projectTotal: number | null;
};

type MetaFieldInputProps = {
  field: keyof QuoteMetadata;
  value?: string;
  placeholder: string;
  onChange: (field: keyof QuoteMetadata, value: string) => void;
  className?: string;
  multiline?: boolean;
};

function MetaFieldInput({ field, value, placeholder, onChange, className, multiline }: MetaFieldInputProps) {
  const commonClasses = `w-full resize-none bg-transparent text-inherit focus:outline-none focus:ring-0 ${className ?? ""}`;
  if (multiline) {
    return (
      <textarea
        rows={3}
        className={`${commonClasses} whitespace-pre-wrap`}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(event) => onChange(field, event.target.value)}
      />
    );
  }
  return (
    <input
      type="text"
      className={commonClasses}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => onChange(field, event.target.value)}
    />
  );
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function labToRgb(lab: string) {
  try {
    const match = lab
      .replace(/\s+/g, " ")
      .match(/^lab\(([^)]+)\)/i);
    if (!match) {
      return lab;
    }

    const parts = match[1]
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (parts.length < 3) {
      return lab;
    }

    const alphaIndex = parts.findIndex((token) => token.includes("/"));
    let alpha = 1;

    if (alphaIndex !== -1) {
      const [value, alphaToken] = parts[alphaIndex].split("/").map((token) => token.trim());
      parts[alphaIndex] = value;
      alpha = Number(alphaToken);
      if (Number.isNaN(alpha)) {
        alpha = 1;
      }
    } else if (parts.length >= 4) {
      alpha = Number(parts[3]);
      if (Number.isNaN(alpha)) {
        alpha = 1;
      }
    }

    const L = parseFloat(parts[0]);
    const a = parseFloat(parts[1]);
    const b = parseFloat(parts[2]);

    // Validate parsed values
    if (Number.isNaN(L) || Number.isNaN(a) || Number.isNaN(b)) {
      return lab; // Return original if parsing fails
    }

    const y = (L + 16) / 116;
    const x = a / 500 + y;
    const z = y - b / 200;

    const f = (t: number) => {
      if (Number.isNaN(t) || !Number.isFinite(t)) {
        return 0;
      }
      return t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787;
    };

    const Xn = 0.95047;
    const Yn = 1.0;
    const Zn = 1.08883;

    const X = Xn * f(x);
    const Y = Yn * f(y);
    const Z = Zn * f(z);

    let r = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
    let g = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
    let bl = X * 0.0557 + Y * -0.204 + Z * 1.057;

    const gamma = (c: number) => {
      if (Number.isNaN(c) || !Number.isFinite(c)) {
        return 0;
      }
      return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    };

    r = clamp(gamma(r));
    g = clamp(gamma(g));
    bl = clamp(gamma(bl));

    const to255 = (c: number) => Math.round(clamp(c) * 255);

    // Validate final RGB values
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(bl)) {
      return lab; // Return original if conversion produces invalid values
    }

    if (alpha < 1) {
      return `rgba(${to255(r)}, ${to255(g)}, ${to255(bl)}, ${clamp(alpha)})`;
    }

    return `rgb(${to255(r)}, ${to255(g)}, ${to255(bl)})`;
  } catch (error) {
    // If any error occurs, return the original value or a safe fallback
    console.warn("Error converting LAB color:", lab, error);
    return lab;
  }
}

function oklabToRgb(oklab: string) {
  try {
    const match = oklab
      .replace(/\s+/g, " ")
      .match(/^oklab\(([^)]+)\)/i);
    if (!match) {
      return oklab;
    }

    const parts = match[1]
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (parts.length < 3) {
      return oklab;
    }

    const alphaIndex = parts.findIndex((token) => token.includes("/"));
    let alpha = 1;

    if (alphaIndex !== -1) {
      const [value, alphaToken] = parts[alphaIndex].split("/").map((token) => token.trim());
      parts[alphaIndex] = value;
      alpha = Number(alphaToken);
      if (Number.isNaN(alpha)) {
        alpha = 1;
      }
    } else if (parts.length >= 4) {
      alpha = Number(parts[3]);
      if (Number.isNaN(alpha)) {
        alpha = 1;
      }
    }

    const L = parseFloat(parts[0]);
    const a = parseFloat(parts[1]);
    const b = parseFloat(parts[2]);

    // Validate parsed values
    if (Number.isNaN(L) || Number.isNaN(a) || Number.isNaN(b)) {
      return oklab;
    }

    // OKLab to linear RGB conversion
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;

    let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    let bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    // Apply gamma correction
    const gamma = (c: number) => {
      if (Number.isNaN(c) || !Number.isFinite(c)) {
        return 0;
      }
      const abs = Math.abs(c);
      if (abs > 0.0031308) {
        return (c > 0 ? 1 : -1) * (1.055 * Math.pow(abs, 1.0 / 2.4) - 0.055);
      }
      return 12.92 * c;
    };

    r = clamp(gamma(r));
    g = clamp(gamma(g));
    bl = clamp(gamma(bl));

    const to255 = (c: number) => Math.round(clamp(c) * 255);

    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(bl)) {
      return oklab;
    }

    if (alpha < 1) {
      return `rgba(${to255(r)}, ${to255(g)}, ${to255(bl)}, ${clamp(alpha)})`;
    }

    return `rgb(${to255(r)}, ${to255(g)}, ${to255(bl)})`;
  } catch (error) {
    console.warn("Error converting OKLab color:", oklab, error);
    return oklab;
  }
}

function normalizeColor(value: string, property?: string) {
  if (!value || typeof value !== "string") {
    return value;
  }
 
  // Check if it contains any unsupported color functions
  const hasUnsupportedColor = /(lab|oklab)\(/i.test(value);
  if (!hasUnsupportedColor) {
    return value;
  }
 
  try {
    // Convert oklab colors first
    let normalized = value.replace(/oklab\([^)]*\)/gi, (match) => {
      try {
        const converted = oklabToRgb(match);
        if (converted === match) {
          // Conversion failed, use fallback
          if (property === "backgroundColor" || property === "background") {
            return "white";
          } else if (property === "color") {
            return "black";
          } else if (property === "borderColor" || property === "border") {
            return "currentColor";
          }
          return "transparent";
        }
        return converted;
      } catch (error) {
        console.warn("Error normalizing OKLab color:", match, error);
        if (property === "backgroundColor" || property === "background") {
          return "white";
        } else if (property === "color") {
          return "black";
        }
        return "transparent";
      }
    });
   
    // Then convert lab colors
    normalized = normalized.replace(/lab\([^)]*\)/gi, (match) => {
      try {
        const converted = labToRgb(match);
        if (converted === match) {
          // Conversion failed, use fallback
          if (property === "backgroundColor" || property === "background") {
            return "white";
          } else if (property === "color") {
            return "black";
          } else if (property === "borderColor" || property === "border") {
            return "currentColor";
          }
          return "transparent";
        }
        return converted;
      } catch (error) {
        console.warn("Error normalizing LAB color:", match, error);
        if (property === "backgroundColor" || property === "background") {
          return "white";
        } else if (property === "color") {
          return "black";
        }
        return "transparent";
      }
    });

    return normalized;
  } catch (error) {
    console.warn("Error in normalizeColor:", value, error);
    // Return safe fallback
    if (property === "backgroundColor" || property === "background") {
      return "white";
    } else if (property === "color") {
      return "black";
    }
    return value;
  }
}

function convertAllColorsInElement(element: HTMLElement) {
  // Convert all color-related styles on this element
  try {
    const style = window.getComputedStyle(element);
    
    // Get and convert all color properties - including shorthand properties
    const colorProps = ['color', 'backgroundColor', 'background', 'borderColor',
                        'borderTopColor', 'borderRightColor', 'borderBottomColor',
                        'borderLeftColor', 'border', 'borderTop', 'borderRight',
                        'borderBottom', 'borderLeft', 'outlineColor', 'outline',
                        'textShadow', 'boxShadow', 'columnRuleColor'] as const;
    
    colorProps.forEach((prop) => {
      try {
        let value = style.getPropertyValue(prop);
        if (!value) {
          // Try camelCase version
          const camelProp = prop.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
          value = (style as any)[camelProp];
        }
        
        if (value && typeof value === 'string') {
          // Handle shadows first as they can contain colors within the value
          if ((prop === 'textShadow' || prop === 'boxShadow') && /(lab|oklab)\(/i.test(value)) {
            // For shadows, try to extract and replace color
            const shadowMatch = value.match(/(lab|oklab\([^)]+\))/gi);
            if (shadowMatch) {
              let shadowValue = value;
              shadowMatch.forEach(match => {
                const normalized = normalizeColor(match, prop);
                if (normalized && !/(lab|oklab)\(/i.test(normalized)) {
                  shadowValue = shadowValue.replace(match, normalized);
                } else {
                  shadowValue = shadowValue.replace(match, 'rgba(0,0,0,0.1)');
                }
              });
              element.style.setProperty(prop, shadowValue, 'important');
            }
          }
          // Handle border shorthand that might contain colors
          else if ((prop === 'border' || prop.startsWith('border')) && !(prop as string).includes('Color') && /(lab|oklab)\(/i.test(value)) {
            // For border shorthand, try to preserve width and style, just replace color
            const borderParts = value.split(/\s+/);
            const hasLabColor = borderParts.some(part => /(lab|oklab)\(/i.test(part));
            if (hasLabColor) {
              const width = borderParts.find(part => /^\d/.test(part)) || '1px';
              const styleType = borderParts.find(part => ['solid', 'dashed', 'dotted', 'double', 'none'].includes(part)) || 'solid';
              element.style.setProperty(prop, `${width} ${styleType} currentColor`, 'important');
            }
          }
          // Handle regular color properties
          else if (/(lab|oklab)\(/i.test(value) || (prop as string).includes('Color')) {
            const normalized = normalizeColor(value, prop);
            if (normalized && !/(lab|oklab)\(/i.test(normalized)) {
              // Use setProperty with !important to ensure it takes precedence
              element.style.setProperty(prop, normalized, 'important');
            } else {
              // Set safe fallback with !important
              if (prop === 'backgroundColor' || prop === 'background') {
                element.style.setProperty('backgroundColor', 'white', 'important');
              } else if (prop === 'color') {
                element.style.setProperty('color', 'black', 'important');
              } else if ((prop as string).includes('border') && (prop as string).includes('Color')) {
                element.style.setProperty(prop, 'currentColor', 'important');
              } else if (prop === 'outlineColor' || prop === 'outline') {
                element.style.setProperty(prop, 'currentColor', 'important');
              }
            }
          }
        }
      } catch (error) {
        // Ignore errors for individual properties - set fallback
        try {
          if (prop === 'backgroundColor' || prop === 'background') {
            element.style.setProperty('backgroundColor', 'white', 'important');
          } else if (prop === 'color') {
            element.style.setProperty('color', 'black', 'important');
          }
        } catch (fallbackError) {
          // Ignore fallback errors too
        }
        // Ignore errors for individual properties - set fallback
        try {
          if (prop === 'backgroundColor' || prop === 'background') {
            element.style.setProperty('backgroundColor', 'white', 'important');
          } else if (prop === 'color') {
            element.style.setProperty('color', 'black', 'important');
          }
        } catch (fallbackError) {
          // Ignore fallback errors too
        }
      }
    });
  } catch (error) {
    // Set safe fallbacks if style access fails
    try {
      element.style.setProperty('color', 'black', 'important');
      element.style.setProperty('backgroundColor', 'white', 'important');
    } catch (fallbackError) {
      // Ignore if fallbacks fail
    }
    // Set safe fallbacks if style access fails
    try {
      element.style.setProperty('color', 'black', 'important');
      element.style.setProperty('backgroundColor', 'white', 'important');
    } catch (fallbackError) {
      // Ignore if fallbacks fail
    }
  }
 
  // Recursively convert colors in all children
  Array.from(element.children).forEach((child) => {
    if (child instanceof HTMLElement) {
      convertAllColorsInElement(child);
    }
  });
  
  // Also check text nodes' parent styles
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let textNode;
  while (textNode = walker.nextNode()) {
    if (textNode.parentElement instanceof HTMLElement) {
      const parentStyle = window.getComputedStyle(textNode.parentElement);
      if (parentStyle.color && /(lab|oklab)\(/i.test(parentStyle.color)) {
        const normalized = normalizeColor(parentStyle.color, "color");
        if (normalized && !/(lab|oklab)\(/i.test(normalized)) {
          textNode.parentElement.style.setProperty('color', normalized, 'important');
        } else {
          textNode.parentElement.style.setProperty('color', 'black', 'important');
        }
      }
    }
  }
}

function createPrintableClone(source: HTMLElement) {
  const clone = source.cloneNode(true) as HTMLElement;

  // Convert input and textarea fields to static text elements
  const convertInputsToText = (element: HTMLElement) => {
    // Find all input and textarea elements
    const inputs = element.querySelectorAll('input, textarea');
    
    inputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
        return;
      }
      
      const span = document.createElement('span');
      // Use value if present, otherwise show placeholder (but not if it's empty)
      // Clean up trailing dashes and whitespace
      let value = input.value || (input.placeholder && input.placeholder.trim() ? input.placeholder : '');
      value = value.replace(/\s*-\s*$/, '').trim(); // Remove trailing dash and whitespace
      span.textContent = value;
      
      // Get computed styles from the cloned input (styles should already be applied)
      // If not, try to find the original input
      let computedStyle = window.getComputedStyle(input);
      
      // Try to find the original input to ensure we have the correct styles
      let originalInput: HTMLInputElement | HTMLTextAreaElement | null = null;
      const inputName = input.getAttribute('name');
      const inputId = input.id;
      
      if (inputId) {
        originalInput = source.querySelector(`#${inputId}`) as HTMLInputElement | HTMLTextAreaElement | null;
      }
      if (!originalInput && inputName) {
        originalInput = source.querySelector(`[name="${inputName}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
      }
      
      if (originalInput) {
        computedStyle = window.getComputedStyle(originalInput);
      }
      
      // Apply all relevant styles - preserve layout properties
      const inputDisplay = computedStyle.display;
      if (inputDisplay === 'inline' || inputDisplay === 'inline-block' || inputDisplay === 'block') {
        span.style.display = inputDisplay;
      } else {
        span.style.display = 'inline-block';
      }
      
      span.style.width = computedStyle.width || '100%';
      span.style.height = computedStyle.height || 'auto';
      span.style.minWidth = computedStyle.minWidth || 'auto';
      span.style.maxWidth = computedStyle.maxWidth || 'none';
      span.style.minHeight = computedStyle.minHeight || 'auto';
      span.style.maxHeight = computedStyle.maxHeight || 'none';
      
      span.style.fontFamily = computedStyle.fontFamily;
      span.style.fontSize = computedStyle.fontSize;
      span.style.fontWeight = computedStyle.fontWeight;
      span.style.fontStyle = computedStyle.fontStyle;
      span.style.lineHeight = computedStyle.lineHeight;
      span.style.letterSpacing = computedStyle.letterSpacing;
      span.style.textAlign = computedStyle.textAlign;
      
      // Preserve flexbox properties if parent is flex
      if (input.parentElement) {
        const parentStyle = window.getComputedStyle(input.parentElement);
        if (parentStyle.display === 'flex' || parentStyle.display === 'inline-flex') {
          span.style.flex = computedStyle.flex;
          span.style.flexGrow = computedStyle.flexGrow;
          span.style.flexShrink = computedStyle.flexShrink;
          span.style.flexBasis = computedStyle.flexBasis;
          span.style.alignSelf = computedStyle.alignSelf;
        }
      }
      
      span.style.padding = computedStyle.padding;
      span.style.paddingTop = computedStyle.paddingTop;
      span.style.paddingRight = computedStyle.paddingRight;
      span.style.paddingBottom = computedStyle.paddingBottom;
      span.style.paddingLeft = computedStyle.paddingLeft;
      span.style.margin = computedStyle.margin;
      span.style.marginTop = computedStyle.marginTop;
      span.style.marginRight = computedStyle.marginRight;
      span.style.marginBottom = computedStyle.marginBottom;
      span.style.marginLeft = computedStyle.marginLeft;
      
      // Normalize colors before applying
      const normalizedSpanColor = normalizeColor(computedStyle.color, "color");
      span.style.color = normalizedSpanColor && !/(lab|oklab)\(/i.test(normalizedSpanColor) 
        ? normalizedSpanColor 
        : "black";
      
      // Normalize border colors
      const normalizedBorderColor = normalizeColor(computedStyle.borderColor, "borderColor");
      span.style.borderColor = normalizedBorderColor && !/(lab|oklab)\(/i.test(normalizedBorderColor)
        ? normalizedBorderColor
        : computedStyle.borderColor || "currentColor";
      
      span.style.borderWidth = computedStyle.borderWidth;
      span.style.borderStyle = computedStyle.borderStyle;
      span.style.borderTopWidth = computedStyle.borderTopWidth;
      span.style.borderRightWidth = computedStyle.borderRightWidth;
      span.style.borderBottomWidth = computedStyle.borderBottomWidth;
      span.style.borderLeftWidth = computedStyle.borderLeftWidth;
      span.style.borderRadius = computedStyle.borderRadius;
      
      // Normalize background color
      const normalizedSpanBg = normalizeColor(computedStyle.backgroundColor, "backgroundColor");
      span.style.backgroundColor = normalizedSpanBg && !/(lab|oklab)\(/i.test(normalizedSpanBg)
        ? normalizedSpanBg
        : "transparent";
      span.style.height = computedStyle.height;
      span.style.whiteSpace = computedStyle.whiteSpace;
      span.style.overflowWrap = computedStyle.overflowWrap;
      span.style.wordBreak = computedStyle.wordBreak;
      span.style.verticalAlign = computedStyle.verticalAlign;
      span.style.opacity = computedStyle.opacity;
      span.style.visibility = computedStyle.visibility;
      
      // Preserve classes for styling
      span.className = input.className;
      
      // For empty values, ensure proper spacing is maintained
      if (!value) {
        span.style.minHeight = computedStyle.minHeight || computedStyle.height || '1em';
      }
      
      // Replace input with span
      if (input.parentNode) {
        input.parentNode.replaceChild(span, input);
      }
    });
  };

  const applyComputedStyles = (originalNode: Element, clonedNode: Element) => {
    if (!(originalNode instanceof HTMLElement) || !(clonedNode instanceof HTMLElement)) {
      return;
    }

    let style: CSSStyleDeclaration;
    try {
      style = window.getComputedStyle(originalNode);
    } catch (error) {
      console.warn("Error getting computed style:", error);
      return; // Skip this node if we can't get its styles
    }
    try {
      const normalizedColor = normalizeColor(style.color, "color");
      if (normalizedColor && !/(lab|oklab)\(/i.test(normalizedColor)) {
        clonedNode.style.color = normalizedColor;
      } else {
        clonedNode.style.color = "black"; // Safe fallback
      }
     
      const normalizedBg = normalizeColor(style.backgroundColor, "backgroundColor");
      if (normalizedBg && !/(lab|oklab)\(/i.test(normalizedBg)) {
        clonedNode.style.backgroundColor = normalizedBg;
      } else {
        clonedNode.style.backgroundColor = "white"; // Safe fallback
      }
      clonedNode.style.font = style.font;
      clonedNode.style.fontSize = style.fontSize;
      clonedNode.style.fontFamily = style.fontFamily;
      clonedNode.style.fontWeight = style.fontWeight;
      clonedNode.style.fontStyle = style.fontStyle;
      clonedNode.style.fontVariant = style.fontVariant;
      clonedNode.style.lineHeight = style.lineHeight;
      clonedNode.style.letterSpacing = style.letterSpacing;
      clonedNode.style.textTransform = style.textTransform;
      clonedNode.style.textDecoration = style.textDecoration;
      clonedNode.style.textIndent = style.textIndent;
      clonedNode.style.textAlign = style.textAlign;
      const normalizedTextShadow = normalizeColor(style.textShadow, "textShadow");
      if (normalizedTextShadow && !/(lab|oklab)\(/i.test(normalizedTextShadow)) {
        clonedNode.style.textShadow = normalizedTextShadow;
      }
     
      clonedNode.style.whiteSpace = style.whiteSpace;
      clonedNode.style.wordWrap = style.wordWrap;
      clonedNode.style.overflowWrap = style.overflowWrap;
      clonedNode.style.wordBreak = style.wordBreak;
      // Preserve all layout properties with !important to ensure they're applied
      // Preserve all layout properties with !important to ensure they're applied
      clonedNode.style.display = style.display;
      clonedNode.style.flexDirection = style.flexDirection;
      clonedNode.style.justifyContent = style.justifyContent;
      clonedNode.style.alignItems = style.alignItems;
      clonedNode.style.alignContent = style.alignContent;
      clonedNode.style.alignSelf = style.alignSelf;
      clonedNode.style.flexWrap = style.flexWrap;
      clonedNode.style.flex = style.flex;
      clonedNode.style.flexGrow = style.flexGrow;
      clonedNode.style.flexShrink = style.flexShrink;
      clonedNode.style.flexBasis = style.flexBasis;
      clonedNode.style.alignContent = style.alignContent;
      clonedNode.style.alignSelf = style.alignSelf;
      clonedNode.style.flexWrap = style.flexWrap;
      clonedNode.style.flex = style.flex;
      clonedNode.style.flexGrow = style.flexGrow;
      clonedNode.style.flexShrink = style.flexShrink;
      clonedNode.style.flexBasis = style.flexBasis;
      clonedNode.style.gap = style.gap;
      clonedNode.style.rowGap = style.rowGap;
      clonedNode.style.columnGap = style.columnGap;
      clonedNode.style.rowGap = style.rowGap;
      clonedNode.style.columnGap = style.columnGap;
      clonedNode.style.padding = style.padding;
      clonedNode.style.paddingTop = style.paddingTop;
      clonedNode.style.paddingRight = style.paddingRight;
      clonedNode.style.paddingBottom = style.paddingBottom;
      clonedNode.style.paddingLeft = style.paddingLeft;
      clonedNode.style.paddingTop = style.paddingTop;
      clonedNode.style.paddingRight = style.paddingRight;
      clonedNode.style.paddingBottom = style.paddingBottom;
      clonedNode.style.paddingLeft = style.paddingLeft;
      clonedNode.style.margin = style.margin;
      clonedNode.style.marginTop = style.marginTop;
      clonedNode.style.marginRight = style.marginRight;
      clonedNode.style.marginBottom = style.marginBottom;
      clonedNode.style.marginLeft = style.marginLeft;
      clonedNode.style.gridTemplateColumns = style.gridTemplateColumns;
      clonedNode.style.gridTemplateRows = style.gridTemplateRows;
      clonedNode.style.gridTemplateAreas = style.gridTemplateAreas;
      clonedNode.style.gridColumn = style.gridColumn;
      clonedNode.style.gridRow = style.gridRow;
      clonedNode.style.gridColumnStart = style.gridColumnStart;
      clonedNode.style.gridColumnEnd = style.gridColumnEnd;
      clonedNode.style.gridRowStart = style.gridRowStart;
      clonedNode.style.gridRowEnd = style.gridRowEnd;
      clonedNode.style.placeItems = style.placeItems;
      clonedNode.style.placeContent = style.placeContent;
      
      const normalizedBorder = normalizeColor(style.border, "border");
      if (normalizedBorder && !/(lab|oklab)\(/i.test(normalizedBorder)) {
        clonedNode.style.border = normalizedBorder;
      } else {
        clonedNode.style.border = style.border || "none";
      }
     
      const normalizedBorderColor = normalizeColor(style.borderColor, "borderColor");
      if (normalizedBorderColor && !/(lab|oklab)\(/i.test(normalizedBorderColor)) {
        clonedNode.style.borderColor = normalizedBorderColor;
      } else {
        clonedNode.style.borderColor = style.borderColor || "currentColor";
      }
     
      clonedNode.style.borderWidth = style.borderWidth;
      clonedNode.style.borderStyle = style.borderStyle;
     
      const normalizedOutline = normalizeColor(style.outline, "outline");
      if (normalizedOutline && !/(lab|oklab)\(/i.test(normalizedOutline)) {
        clonedNode.style.outline = normalizedOutline;
      } else {
        clonedNode.style.outline = style.outline || "none";
      }
     
      clonedNode.style.borderRadius = style.borderRadius;
     
      const normalizedBoxShadow = normalizeColor(style.boxShadow, "boxShadow");
      if (normalizedBoxShadow && !/(lab|oklab)\(/i.test(normalizedBoxShadow)) {
        clonedNode.style.boxShadow = normalizedBoxShadow;
      } else {
        clonedNode.style.boxShadow = style.boxShadow || "none";
      }
    } catch (error) {
      console.warn("Error applying computed styles:", error);
      // Set safe fallback colors to prevent LAB color errors
      try {
        clonedNode.style.color = "black";
        clonedNode.style.backgroundColor = "white";
        clonedNode.style.borderColor = "currentColor";
      } catch (fallbackError) {
        console.warn("Error setting fallback colors:", fallbackError);
      }
    }
    clonedNode.style.maxWidth = style.maxWidth;
    clonedNode.style.minWidth = style.minWidth;
    clonedNode.style.width = style.width;
    clonedNode.style.height = style.height;
    clonedNode.style.minHeight = style.minHeight;
    clonedNode.style.maxHeight = style.maxHeight;
    clonedNode.style.listStyle = style.listStyle;
    clonedNode.style.listStyleType = style.listStyleType;
    clonedNode.style.listStylePosition = style.listStylePosition;
    clonedNode.style.verticalAlign = style.verticalAlign;

    const originalChildren = Array.from(originalNode.children);
    const clonedChildren = Array.from(clonedNode.children);
    originalChildren.forEach((child, index) => {
      const clonedChild = clonedChildren[index];
      if (clonedChild) {
        applyComputedStyles(child, clonedChild);
      }
    });
  };

  applyComputedStyles(source, clone);
  
  // Convert all input fields to static text elements for better PDF rendering
  convertInputsToText(clone);
  
  // Convert all LAB/OKLab colors in the clone before html2canvas processes it
  convertAllColorsInElement(clone);

  const rect = source.getBoundingClientRect();
  const scrollWidth = source.scrollWidth || rect.width;
  const scrollHeight = source.scrollHeight || rect.height;

  clone.style.position = "absolute";
  clone.style.left = "0";
  clone.style.top = "0";
  clone.style.pointerEvents = "none";
  clone.style.zIndex = "-9999";
  clone.style.backgroundColor = "#ffffff";
  clone.style.width = `${scrollWidth}px`;
  clone.style.height = `${scrollHeight}px`;
  clone.style.overflow = "visible";
  clone.style.opacity = "1";
  clone.style.visibility = "visible";
  clone.style.display = "block";
  clone.style.display = "block";
  clone.classList.add("__pdf-clone");
  
  // Ensure all child elements are visible in the clone
  const ensureVisibility = (element: HTMLElement) => {
    const style = window.getComputedStyle(element);
    
    // Skip if element is intentionally hidden
    if (style.display === "none" && element.tagName !== 'SCRIPT' && element.tagName !== 'STYLE') {
      // For table rows and important elements, ensure they're visible
      if (element.tagName === 'TR' || element.classList.contains('border-blue-200')) {
        element.style.display = 'table-row';
        element.style.visibility = 'visible';
        element.style.opacity = '1';
      } else {
        return;
      }
    }
    
    if (style.visibility === "hidden") {
      element.style.visibility = "visible";
      element.style.setProperty('visibility', 'visible', 'important');
    }
    if (style.opacity === "0" || parseFloat(style.opacity) === 0) {
      element.style.opacity = "1";
      element.style.setProperty('opacity', '1', 'important');
    }
    
    // Ensure table rows are always visible
    if (element.tagName === 'TR') {
      element.style.display = 'table-row';
      element.style.setProperty('display', 'table-row', 'important');
      element.style.visibility = 'visible';
      element.style.setProperty('visibility', 'visible', 'important');
      element.style.opacity = '1';
      element.style.setProperty('opacity', '1', 'important');
      element.style.position = 'static';
      element.style.height = 'auto';
      element.style.minHeight = 'auto';
    }
    
    // Special handling for discount rows - ALWAYS force visibility
    if (element.tagName === 'TR' && (element.classList.contains('discount-row') || element.getAttribute('data-discount-row') === 'true')) {
      // Check if discount row should be shown by checking for discount value in the content
      const discountCell = element.querySelector('td:last-child');
      const hasDiscountValue = discountCell && discountCell.textContent && 
                               discountCell.textContent.trim() !== '' && 
                               discountCell.textContent.trim() !== '-';
      
      // Force visibility if there's a discount value
      if (hasDiscountValue) {
        element.style.display = 'table-row';
        element.style.setProperty('display', 'table-row', 'important');
        element.style.visibility = 'visible';
        element.style.setProperty('visibility', 'visible', 'important');
        element.style.opacity = '1';
        element.style.setProperty('opacity', '1', 'important');
        element.style.position = 'static';
        element.style.height = 'auto';
        element.style.minHeight = 'auto';
        element.style.removeProperty('display'); // Remove any display:none
        element.style.removeProperty('visibility'); // Remove any hidden
        element.style.removeProperty('opacity'); // Remove any opacity 0
        
        // Also ensure all child elements are visible
        Array.from(element.children).forEach((child) => {
          if (child instanceof HTMLElement) {
            child.style.display = 'table-cell';
            child.style.setProperty('display', 'table-cell', 'important');
            child.style.visibility = 'visible';
            child.style.setProperty('visibility', 'visible', 'important');
            child.style.opacity = '1';
            child.style.setProperty('opacity', '1', 'important');
            // Remove any hiding styles
            child.style.removeProperty('display');
            child.style.removeProperty('visibility');
            child.style.removeProperty('opacity');
          }
        });
        
        // Ensure nested divs are visible
        const innerDivs = element.querySelectorAll('div');
        innerDivs.forEach((div) => {
          if (div instanceof HTMLElement) {
            div.style.display = 'flex';
            div.style.setProperty('display', 'flex', 'important');
            div.style.visibility = 'visible';
            div.style.setProperty('visibility', 'visible', 'important');
            div.style.opacity = '1';
            div.style.setProperty('opacity', '1', 'important');
          }
        });
      }
    }
    
    // Ensure table cells are visible
    if (element.tagName === 'TD' || element.tagName === 'TH') {
      element.style.display = 'table-cell';
      element.style.setProperty('display', 'table-cell', 'important');
      element.style.visibility = 'visible';
      element.style.setProperty('visibility', 'visible', 'important');
      element.style.opacity = '1';
      element.style.setProperty('opacity', '1', 'important');
    }
    
    // Special handling for discount cards
    if (element.classList.contains('discount-card') || element.getAttribute('data-discount-card') === 'true') {
      // Check if discount card has content - look for the paragraph with discount amount
      // Try multiple selectors to find the discount amount paragraph
      const discountAmount = element.querySelector('p.text-3xl, p.mt-3, p[class*="text-3xl"], p[class*="mt-3"]') ||
                           Array.from(element.querySelectorAll('p')).find(p => {
                             const text = p.textContent?.trim() || '';
                             return text !== '' && text !== '-' && !text.match(/^[\s₹,-]*$/) && 
                                    (p.classList.contains('text-3xl') || p.classList.contains('mt-3') || 
                                     p.style.fontSize?.includes('1.875rem') || p.style.fontSize?.includes('30px'));
                           });
      
      const hasContent = discountAmount && discountAmount.textContent && 
                        discountAmount.textContent.trim() !== '' && 
                        discountAmount.textContent.trim() !== '-' &&
                        !discountAmount.textContent.trim().match(/^[\s₹,-]*$/);
      
      if (hasContent) {
        element.style.display = 'block';
        element.style.setProperty('display', 'block', 'important');
        element.style.visibility = 'visible';
        element.style.setProperty('visibility', 'visible', 'important');
        element.style.opacity = '1';
        element.style.setProperty('opacity', '1', 'important');
        
        // Ensure ALL child elements are visible - title (h4), amount (p.text-3xl), and description (p.mt-2)
        const children = element.querySelectorAll('*');
        children.forEach((child) => {
          if (child instanceof HTMLElement) {
            child.style.visibility = 'visible';
            child.style.setProperty('visibility', 'visible', 'important');
            child.style.opacity = '1';
            child.style.setProperty('opacity', '1', 'important');
            // Preserve display property but ensure visibility
            if (child.style.display === 'none') {
              child.style.display = '';
              child.style.removeProperty('display');
            }
            
            // Ensure h4 title is visible (DISCOUNT APPLIED / TOTAL PAYABLE)
            if (child.tagName === 'H4') {
              child.style.display = 'block';
              child.style.setProperty('display', 'block', 'important');
              child.style.visibility = 'visible';
              child.style.setProperty('visibility', 'visible', 'important');
              child.style.opacity = '1';
              child.style.setProperty('opacity', '1', 'important');
              try {
                const computedStyle = window.getComputedStyle(child);
                if (computedStyle.color) {
                  child.style.color = computedStyle.color;
                  child.style.setProperty('color', computedStyle.color, 'important');
                }
                if (computedStyle.fontSize) {
                  child.style.fontSize = computedStyle.fontSize;
                }
                if (computedStyle.fontWeight) {
                  child.style.fontWeight = computedStyle.fontWeight;
                }
                if (computedStyle.textTransform) {
                  child.style.textTransform = computedStyle.textTransform;
                }
              } catch (e) {
                // Preserve default styling
              }
            }
            
            // Ensure discount amount paragraph is visible and has proper styling
            if (child === discountAmount || (child.tagName === 'P' && (child.classList.contains('text-3xl') || child.classList.contains('mt-3')))) {
              child.style.display = 'block';
              child.style.setProperty('display', 'block', 'important');
              child.style.visibility = 'visible';
              child.style.setProperty('visibility', 'visible', 'important');
              child.style.opacity = '1';
              child.style.setProperty('opacity', '1', 'important');
              // Ensure text color is visible (convert blue-600/80 to solid blue)
              try {
                const computedStyle = window.getComputedStyle(child);
                if (computedStyle.color) {
                  child.style.color = computedStyle.color;
                  child.style.setProperty('color', computedStyle.color, 'important');
                } else {
                  // Fallback to a visible dark blue color
                  child.style.color = '#1e40af';
                  child.style.setProperty('color', '#1e40af', 'important');
                }
                // Ensure font size and weight are preserved
                if (computedStyle.fontSize) {
                  child.style.fontSize = computedStyle.fontSize;
                }
                if (computedStyle.fontWeight) {
                  child.style.fontWeight = computedStyle.fontWeight;
                }
              } catch (e) {
                // Fallback styling
                child.style.color = '#1e40af';
                child.style.fontSize = '1.875rem';
                child.style.fontWeight = '700';
              }
            }
            
            // Ensure description paragraph is visible (Subtracted from rooms total / After applying discount)
            if (child.tagName === 'P' && (child.classList.contains('mt-2') || child.classList.contains('text-xs'))) {
              child.style.display = 'block';
              child.style.setProperty('display', 'block', 'important');
              child.style.visibility = 'visible';
              child.style.setProperty('visibility', 'visible', 'important');
              child.style.opacity = '1';
              child.style.setProperty('opacity', '1', 'important');
              try {
                const computedStyle = window.getComputedStyle(child);
                if (computedStyle.color) {
                  child.style.color = computedStyle.color;
                  child.style.setProperty('color', computedStyle.color, 'important');
                }
                if (computedStyle.fontSize) {
                  child.style.fontSize = computedStyle.fontSize;
                }
              } catch (e) {
                // Preserve default styling
              }
            }
          }
        });
      } else {
        // Hide the card if there's no content to avoid empty boxes
        element.style.display = 'none';
        element.style.setProperty('display', 'none', 'important');
      }
    }
    
    // Process children
    Array.from(element.children).forEach((child) => {
      if (child instanceof HTMLElement) {
        ensureVisibility(child);
      }
    });
  };
  
  ensureVisibility(clone);

  // Create a container to hold the clone off-screen but still accessible
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = `${scrollWidth}px`;
  container.style.height = `${scrollHeight}px`;
  container.style.overflow = "visible";
  container.appendChild(clone);
  document.body.appendChild(container);

  return {
    clone,
    cleanup: () => {
      container.remove();
    },
  };
}

const PreviewContent = forwardRef<HTMLDivElement, PreviewContentProps>(
  ({ meta: metaProp, rooms, summary, formatNumber, formatCurrency, onMetaChange, projectTotal: projectTotalProp }, ref) => {
    if (summary) {
      // eslint-disable-next-line no-console
      console.log("Room summary from API:", summary);
    }

    const effectiveTotal = projectTotalProp;

    const discountAmountValue =
      typeof metaProp?.discountAmount === "number" && !Number.isNaN(metaProp.discountAmount)
        ? metaProp.discountAmount
        : null;
    const roomSummaryRows = summary?.rows ?? [];
    const discountValue = summary?.discount ?? null;
    const subtotalValue = summary?.subtotal ?? null;
    const totalPayableValue = summary?.totalPayable ?? null;
    const hasSummaryTable =
      roomSummaryRows.length > 0 ||
      discountValue != null ||
      subtotalValue != null ||
      totalPayableValue != null;

    const formatMoney = (value?: number) =>
      value != null && !Number.isNaN(value) ? formatCurrency.format(value) : "-";

    const totalsRow = roomSummaryRows.reduce<{
      modules: number;
      accessories: number;
      appliances: number;
      services: number;
      furniture: number;
      total: number;
    }>((acc, row) => {
      acc.modules += row.modules ?? 0;
      acc.accessories += row.accessories ?? 0;
      acc.appliances += row.appliances ?? 0;
      acc.services += row.services ?? 0;
      acc.furniture += row.furniture ?? 0;
      acc.total +=
        row.total ??
        (row.modules ?? 0) +
          (row.accessories ?? 0) +
          (row.appliances ?? 0) +
          (row.services ?? 0) +
          (row.furniture ?? 0);
      return acc;
    }, {
      modules: 0,
      accessories: 0,
      appliances: 0,
      services: 0,
      furniture: 0,
      total: 0,
    });

    const totalBeforeDiscount =
      subtotalValue ?? (roomSummaryRows.length > 0 ? totalsRow.total : null);

    const effectiveDiscountValue =
      discountAmountValue ?? discountValue ?? null;
      discountAmountValue ?? discountValue ?? null;

    const calculatedTotalAfterDiscount =
      totalPayableValue != null
        ? totalPayableValue
        : totalBeforeDiscount != null
          ? Math.max(totalBeforeDiscount - (effectiveDiscountValue ?? 0), 0)
          : null;

    const paymentBase =
      calculatedTotalAfterDiscount != null ? calculatedTotalAfterDiscount : null;

    const paymentRows = PAYMENT_SCHEDULE.map((row) => {
      const amount = paymentBase != null ? (paymentBase * row.percentage) / 100 : null;
      return {
        ...row,
        amount,
      };
    });

    const paymentTotal = paymentBase;

    return (
      <div ref={ref} className="space-y-10 p-8">
      {metaProp && (
        <section className="space-y-6">
          <div className="space-y-4 border-b border-zinc-200 pb-4">
            <h1 className="text-4xl font-bold text-zinc-900">Quotation</h1>
            <div className="space-y-2">
              <div className="flex flex-col gap-4 md:flex-row md:items-baseline md:justify-between">
                <div className="text-sm text-zinc-600 leading-[1.5rem] m-0 whitespace-normal">
                  Hi{" "}
                  <MetaFieldInput
                    field="customer"
                    value={metaProp.customer}
                    placeholder="Customer Name"
                    onChange={onMetaChange}
                    className="inline-block w-auto border-b border-dotted border-zinc-400 pb-0.5"
                  />&amp;Family,
                </div>
                <div className="text-sm text-zinc-600 leading-[1.5rem] whitespace-nowrap m-0 ml-3 flex items-baseline justify-end">
                  <span>Issued on:</span>
                  <MetaFieldInput
                    field="quoteDate"
                    value={metaProp.quoteDate}
                    placeholder="DD/MM/YYYY"
                    onChange={onMetaChange}
                    className="inline-block w-auto border-b border-dotted border-zinc-400 pb-0.5 ml-0.5"
                  />
                </div>
              </div>
              <p className="text-sm text-zinc-600">
                Here is the quote that you requested. Please review and reach out to us for any
                questions.
              </p>
              <div className="flex justify-end">
                <MetaFieldInput
                  field="quoteNumber"
                  value={metaProp.quoteNumber}
                  placeholder="QUOTE-####"
                  onChange={onMetaChange}
                  className="text-1xl font-semibold text-zinc-900"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-base font-semibold text-zinc-900">Project Details</h2>
            <div className="grid gap-4 rounded-3xl border border-zinc-200 bg-zinc-50 p-6 text-sm shadow-sm md:grid-cols-2 lg:grid-cols-4">
              {[
                { field: "propertyName" as const },
                { field: "totalBuiltUpArea" as const },
                { field: "propertyConfig" as const },
                { field: "designerName" as const, subtitleField: "designerEmail" as const },
                { field: "quoteValidTill" as const },
                { field: "quoteStatus" as const },
                { field: "discountAmount" as const },
                { field: "address" as const, fullWidth: true, multiline: true },
              ].map(({ field, subtitleField, fullWidth, multiline }) => {
                const config = METADATA_FIELDS.find((item) => item.field === field);
                const subtitleConfig = subtitleField ? METADATA_FIELDS.find((item) => item.field === subtitleField) : null;
                const valueFromMeta = metaProp ? (metaProp as Record<string, unknown>)[field as string] : undefined;
                const fieldValue = valueFromMeta != null ? String(valueFromMeta) : "";
                return (
                  <div
                    key={field}
                    className={`flex flex-col gap-1 rounded-2xl border border-transparent bg-white p-4 ${
                      fullWidth ? "md:col-span-2 lg:col-span-4" : ""
                    }`}
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      {config?.label ?? field}
                    </span>
                    <div className="flex flex-col gap-0.5">
                    <div className="flex flex-col gap-0.5">
                    <MetaFieldInput
                      field={field}
                      value={fieldValue}
                      placeholder={config?.label ?? "Enter value"}
                      onChange={onMetaChange}
                      className="text-base font-semibold text-zinc-900"
                      multiline={multiline || config?.multiline}
                    />
                    {subtitleField && (
                      <MetaFieldInput
                        field={subtitleField}
                        value={
                          subtitleField && metaProp
                            ? String((metaProp as Record<string, unknown>)[subtitleField] ?? "")
                            : ""
                        }
                        placeholder={subtitleConfig?.label ?? "Details"}
                        onChange={onMetaChange}
                        className="text-xs text-zinc-500 break-words leading-tight"
                      />
                    )}
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {hasSummaryTable && (
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-zinc-900">Room Summary</h3>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm text-zinc-700">
              <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600">
                <tr>
                  <th className="px-4 py-3">Room</th>
                  <th className="px-4 py-3 text-right">Modules</th>
                  <th className="px-4 py-3 text-right">Accessories</th>
                  <th className="px-4 py-3 text-right">Appliances</th>
                  <th className="px-4 py-3 text-right">Services</th>
                  <th className="px-4 py-3 text-right">Furniture</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {roomSummaryRows.map((row) => (
                  <tr key={row.room} className="border-t border-zinc-100">
                    <td className="px-4 py-3 font-semibold uppercase tracking-wide bg-red-600 text-white">
                      {row.room}
                    </td>
                    <td className="px-4 py-3 text-right">{formatMoney(row.modules)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(row.accessories)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(row.appliances)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(row.services)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(row.furniture)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-900">
                      {formatMoney(row.total)}
                    </td>
                  </tr>
                ))}
                {roomSummaryRows.length > 0 && (
                  <tr className="border-t border-zinc-200 bg-zinc-100 font-semibold uppercase tracking-wide text-zinc-900">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.modules)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.accessories)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.appliances)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.services)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.furniture)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.total)}</td>
                  </tr>
                )}
                {/* Always render discount row - use display to show/hide instead of conditional rendering */}
                <tr 
                  className="border-t border-blue-200 bg-blue-50 font-semibold discount-row" 
                  data-discount-row="true"
                  style={{ 
                    display: (() => {
                      const discountToShow = effectiveDiscountValue ?? discountAmountValue ?? null;
                      const shouldShowDiscount = (discountToShow != null && discountToShow !== 0) || 
                                               (discountAmountValue != null && discountAmountValue !== 0);
                      return shouldShowDiscount && discountToShow != null ? 'table-row' : 'none';
                    })(),
                    visibility: 'visible',
                    opacity: '1',
                    position: 'static',
                    height: 'auto',
                    minHeight: 'auto',
                    width: '100%'
                  }}
                >
                  <td 
                    className="px-4 py-3" 
                    colSpan={6} 
                    style={{ 
                      display: 'table-cell',
                      visibility: 'visible',
                      opacity: '1',
                      width: 'auto'
                    }}
                  >
                    <div 
                      className="flex justify-end uppercase tracking-wide text-blue-600" 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'flex-end',
                        visibility: 'visible',
                        opacity: '1',
                        width: '100%'
                      }}
                    >
                      Discount
                    </div>
                    </td>
                  <td 
                    className="px-4 py-3 text-right text-blue-600 font-bold" 
                    style={{ 
                      display: 'table-cell', 
                      textAlign: 'right',
                      visibility: 'visible',
                      opacity: '1',
                      width: 'auto'
                    }}
                  >
                    {(() => {
                      const discountToShow = effectiveDiscountValue ?? discountAmountValue ?? null;
                      return discountToShow != null ? formatMoney(Math.abs(discountToShow)) : '';
                    })()}
                  </td>
                  </tr>
                {calculatedTotalAfterDiscount != null && (
                  <tr className="border-t border-zinc-200 bg-zinc-200 font-semibold uppercase tracking-wide text-zinc-900">
                    <td className="px-4 py-3">Total after discount</td>
                    <td className="px-4 py-3 text-right " colSpan={5}></td>
                    <td className="px-4 py-3 text-right">{formatMoney(calculatedTotalAfterDiscount)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500">* All amounts include GST @ 18%</p>
        </section>
      )}

      {(effectiveDiscountValue != null || calculatedTotalAfterDiscount != null || discountAmountValue != null) && (
        <section className="grid gap-4 sm:grid-cols-2" data-discount-section="true">
          {/* Always render discount card - control visibility with display instead of conditional rendering */}
          {(() => {
            const discountToShow = effectiveDiscountValue ?? discountAmountValue ?? discountValue ?? null;
            const shouldShowDiscount = (discountToShow != null && discountToShow !== 0);
            const discountAmountText = discountToShow != null ? formatMoney(Math.abs(discountToShow)) : '';
            
            if (!shouldShowDiscount || discountToShow == null) {
              return null;
            }
            
            return (
          <div 
            className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-sm discount-card" 
            data-discount-card="true"
            style={{
                  display: 'block',
              visibility: 'visible',
              opacity: '1',
              position: 'relative',
              minHeight: 'auto'
            }}
          >
            <h4 className="text-xs text-blue-800 font-semibold uppercase tracking-[0.2em]" style={{ display: 'block', visibility: 'visible', opacity: '1', color: '#1e40af' }}>
              DISCOUNT APPLIED
            </h4>
            <p className="mt-3 text-blue-800 text-3xl font-bold" style={{ display: 'block', visibility: 'visible', opacity: '1', fontSize: '1.875rem', fontWeight: '700', color: '#1e40af' }}>
                  {discountAmountText}
            </p>
                {totalBeforeDiscount != null && discountToShow !== 0 ? (
                <p className="mt-2 text-xs text-blue-800" style={{ display: 'block', visibility: 'visible', opacity: '1', color: '#1e40af' }}>
                  Subtracted from rooms total of {formatMoney(totalBeforeDiscount)}
                </p>
                ) : null}
          </div>
            );
          })()}
          {calculatedTotalAfterDiscount != null && (
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
              <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800" style={{ color: '#166534' }}>TOTAL PAYABLE</h4>
              <p className="mt-3 text-3xl font-bold text-emerald-800" style={{ color: '#166534' }}>{formatMoney(calculatedTotalAfterDiscount)}</p>
              {(() => {
                const discountToShow = effectiveDiscountValue ?? discountAmountValue ?? null;
                if (discountToShow != null && discountToShow !== 0) {
                  return (
                  <p className="mt-2 text-xs text-emerald-800" style={{ color: '#166534' }}>
                    After applying discount of {formatMoney(Math.abs(discountToShow))}
                  </p>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </section>
      )}

      {rooms.map((room) => {
        const roomHasTypes = room.types.length > 0;
        if (!roomHasTypes) {
          return null;
        }

        return (
          <section key={room.name} className="space-y-6">
            <div className="border-b border-zinc-200 pb-2">
              <h3 className="text-lg font-semibold text-zinc-900">
                {room.name}
              </h3>
            </div>

            <div className="space-y-6">
              {room.types.map((type) => {
                const hasMaterials = Object.keys(type.materials).length > 0;
                const hasPricing = type.stats.total != null;
                const showInfoSections = hasMaterials || hasPricing;
                const gridColumns = hasMaterials && hasPricing ? "md:grid-cols-2" : "md:grid-cols-1";

                return (
                  <div
                    key={`${room.name}-${type.type}`}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 shadow-sm"
                  >
                    <header className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h4 className="text-base font-semibold text-zinc-900">
                          {type.label}
                        </h4>
                        <p className="text-xs uppercase tracking-wide text-zinc-500">
                          {type.type}
                        </p>
                      </div>
                      <div className="text-sm text-zinc-600">
                        {type.dimensionAggregate
                          ? `Total width: ${formatNumber.format(type.dimensionAggregate)} (units as per sheet)`
                          : ""}
                      </div>
                    </header>

                    {showInfoSections && (
                      <div className={`grid gap-4 ${gridColumns}`}>
                        {hasMaterials && (
                          <div className="space-y-2">
                            <h5 className="text-sm font-semibold text-zinc-800">
                              Materials
                            </h5>
                            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-700">
                              {Object.entries(type.materials).map(([key, value]) => (
                                <p key={key}>
                                  <span className="font-medium text-zinc-900">
                                    {key}:
                                  </span>{" "}
                                  {value}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

                        {hasPricing && (
                          <div className="space-y-2">
                            <h5 className="text-sm font-semibold text-zinc-800">
                              Pricing Summary
                            </h5>
                            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
                              <p>
                                <span className="font-medium">Total:</span>{" "}
                                {type.stats.total != null
                                  ? formatCurrency.format(type.stats.total)
                                  : "-"}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {type.items.length > 0 && (
                      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                        <table className="w-full min-w-[600px] text-left text-sm text-zinc-700">
                          <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600">
                            <tr>
                              <th className="px-4 py-3">Code</th>
                              <th className="px-4 py-3">Unit Name</th>
                              <th className="px-4 py-3">Dimension</th>
                              <th className="px-4 py-3 text-right">Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {type.items.map((item, index) => (
                              <tr
                                key={`${type.type}-${item.code || "no-code"}-${index}`}
                                className="border-t border-zinc-100"
                              >
                                <td className="px-4 py-3 font-medium text-zinc-900">
                                  {item.code || "-"}
                                </td>
                                <td className="px-4 py-3">{item.description}</td>
                                <td className="px-4 py-3">{item.size || "-"}</td>
                                <td className="px-4 py-3 text-right">
                                  {typeof item.price === "number"
                                    ? formatCurrency.format(item.price)
                                    : "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="space-y-6">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-semibold text-zinc-900">
            Project Policies &amp; Materials
          </h2>
          <p className="text-sm text-zinc-600">
            Specifications, materials, and policies governing design, installation, and service.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900">Core Materials</h3>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm text-zinc-700">
              <tbody>
                {["Core Materials (Kitchen base unit, Bathroom Vanity Carcass, etc.)", "Dry Areas (Wardrobe & Lofts, TV units,etc)"]
                  .map((label, index) => {
                    const value = index === 0 ? "Century BWP (IS-710 Grade)" : "Century Sainik MR (ISI-303)";
                    return (
                      <tr key={label} className="border-t border-zinc-100 first:border-t-0">
                        <td className="px-4 py-3 font-medium text-zinc-900">{label}</td>
                        <td className="px-4 py-3">{value}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-zinc-600">
            ALL MODULES CAN BE CUSTOMIZED AS PER REQUIREMENT / ACTUAL SIZE
          </p>
          <p className="text-sm text-zinc-600">
            Note: Plywood is not suggested for shutters, as they bend over time. HDHMR Pro is a better alternative
            &amp; recommended.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900">Material Thickness</h3>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm text-zinc-700">
              <tbody>
                {[
                  {
                    label: "Front Shutters, Doors, Exterior Frame",
                    value: "18mm (Including laminate)",
                  },
                  {
                    label: "Back panels & below drawer panel",
                    value: "8mm (Including Laminate)",
                  },
                ].map((row) => (
                  <tr key={row.label} className="border-t border-zinc-100 first:border-t-0">
                    <td className="px-4 py-3 font-medium text-zinc-900">{row.label}</td>
                    <td className="px-4 py-3">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900">Core Material Brands</h3>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm text-zinc-700">
              <tbody>
                {[
                  { label: "BWP (Boiling water proof)", value: "Century Club Prime" },
                  { label: "MR (Moisture Resistance)", value: "Century Sainik" },
                  { label: "HDHMR Pro", value: "Action Tesa" },
                  { label: "MDF", value: "Action Tesa / Green Panel" },
                  { label: "Edge Banding (Outside)", value: "Rehau (2mm Exterior)" },
                  { label: "Edge Banding (Inside)", value: "Rehau (0.8mm Exterior)" },
                ].map((row) => (
                  <tr key={row.label} className="border-t border-zinc-100 first:border-t-0">
                    <td className="px-4 py-3 font-medium text-zinc-900">{row.label}</td>
                    <td className="px-4 py-3">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-zinc-600">
            We recommend checking physical samples of all finish options at our experience centers.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900">Finish Options</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm">
            <ul className="space-y-2">
              <li>Outside Laminates: 1 mm thickness, choose from 200+ options. Prices vary by laminate range.</li>
              <li>
                Brand Options: Laminates sourced from Merino, Greenlam, Royale Touche, Dorby. Edge bands are pre-matched
                where available.
              </li>
              <li>
                Additional laminate options may incur higher pricing and timelines due to availability and optimization.
              </li>
              <li>Other finishes such as Veneer/Membrane/Acrylic/Duco/PU available at extra cost.</li>
              <li>
                Inside Laminates: 0.72 mm white by default. Choose from 30+ options (price varies with selection).
              </li>
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900">Adhesive &amp; Accessories</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm">
            <p className="font-semibold text-zinc-900">Adhesive</p>
            <p>Brand: Fevicol</p>
            <hr className="my-3 border-zinc-200" />
            <p className="font-semibold text-zinc-900">Accessories Included</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Shutter Hinges: Hettich, Ebco, Häfele</li>
              <li>Drawer Channels: Hettich, Ebco, Häfele</li>
              <li>Soft-close options available at extra cost</li>
              <li>Glass &amp; Mirror: Saint Gobain / Modi Guard (additional charges)</li>
              <li>Hettich is default; other brands available with price variance</li>
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900">Design Information</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm">
            <ul className="list-disc space-y-1 pl-5">
              <li>Manufacturing Type: Fully modular by default; customizable during design phase.</li>
              <li>Wardrobe internal design includes 1 drawer &amp; two shelves by default; final cost as per selection.</li>
              <li>70+ optimized wardrobe internal presets available.</li>
              <li>Custom non-optimized designs possible with additional timeline and pricing.</li>
              <li>Mirrors chargeable if required.</li>
              <li>Detachable modular kitchen skirting provided based on site conditions (wooden skirting by default).</li>
              <li>All dimensions can be customized; new designs may require extra timeline.</li>
              <li>Manual works (strip laminate designs, etc.) charged extra.</li>
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900">Site Usage &amp; Terms</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm space-y-3">
            <div>
              <p className="font-semibold text-zinc-900">Flat Usage</p>
              <p>Workers require electrical &amp; water connections and one bathroom during the project schedule.</p>
            </div>
            <div>
              <p className="font-semibold text-zinc-900">Design Sign-off Terms</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Laminate colors may vary from renders; check samples before finalizing.</li>
                <li>Wood grain laminates: review full sheet if required before production.</li>
                <li>Closest matching Rehau edge banding used; customization not available.</li>
                <li>No design changes permitted after sign-off &amp; material procurement.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-zinc-900">Cleaning</p>
              <p>
                One-time professional cleaning (furniture, bathrooms, debris removal) provided at project end. Interim
                cleaning for occasions such as Pooja is chargeable.
              </p>
            </div>
            <div>
              <p className="font-semibold text-zinc-900">Final Coat of Paint</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Recommended after interior completion to address installation marks.</li>
                <li>Cost excluded unless specified in quote.</li>
                <li>False ceiling painting included if opted.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900">Post Handover Service</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm">
            <ul className="list-disc space-y-1 pl-5">
              <li>Raise issues via care@hubinterior.com after handover.</li>
              <li>Two free service visits within 12 months for routine maintenance &amp; alignments.</li>
              <li>Post-free period visits charged at ₹499 (alignment only; replacements extra).</li>
              <li>
                Warranty replacements covered without service fee; non-warranty replacements chargeable in addition to the
                service fee.
              </li>
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900">Warranty</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm">
            <ul className="list-disc space-y-1 pl-5">
              <li>Modular units: 10-year product warranty against manufacturing defects.</li>
              <li>Hardware, accessories &amp; appliances: as per manufacturer warranty.</li>
              <li>Mirrors &amp; glass excluded post handover.</li>
              <li>
                Warranty void for third-party components, force majeure, negligence, water damage, misuse, accidents, or
                tampering.
              </li>
              <li>Does not cover solid wood furniture, civil works, electrical fittings, paint/polish, or non-branded accessories.</li>
              <li>HUB not liable for loss or damage from force majeure events.</li>
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900">Payment Schedule</h3>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm text-zinc-700">
              <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600">
                <tr>
                  <th className="px-4 py-3">Milestone</th>
                  <th className="px-4 py-3">Percentage</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {paymentRows.map((row) => (
                  <tr key={row.stage} className="border-t border-zinc-100 first:border-t-0">
                    <td className="px-4 py-3 font-medium text-zinc-900">{row.stage}</td>
                    <td className="px-4 py-3">{row.percentage}%</td>
                    <td className="px-4 py-3 text-right">
                      {row.amount != null ? formatCurrency.format(row.amount) : "-"}
                    </td>
                  </tr>
                ))}

                <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold">
                  <td className="px-4 py-3 text-zinc-900">Total</td>
                  <td className="px-4 py-3">100%</td>
                  <td className="px-4 py-3 text-right">
                    {paymentTotal != null ? formatCurrency.format(paymentTotal) : "-"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500">
            Update the discount amount above to refresh the payable totals automatically.
          </p>
          <p className="text-sm text-zinc-600">
            Works like electrical, plumbing, painting, countertops, tiling, false ceiling, etc., are considered under civil work.
          </p>
          <p className="text-sm text-zinc-600">
            Non-modular products include appliances, fixtures, lighting, decor items, wallpapers, wooden flooring, blinds,
            curtains, readymade furniture, etc.
          </p>
          <p className="text-sm text-zinc-600">
            * NEFT/IMPS accepted. Card/NetBanking attracts 2% convenience fee (waived for first 10% tranche).
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900">Cancellation &amp; Scope Change</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm">
            <ul className="list-disc space-y-1 pl-5">
              <li>Booking: 100% design advance refundable if HUB can't match a valid competitor quote within 24 hours.</li>
              <li>Design Stage: No refunds.</li>
              <li>Production Stage: No refunds after materials are ordered.</li>
              <li>
                Refunds (if applicable) processed post execution of refund deed within 21 working days after finance confirmation.
              </li>
              <li>
                Descoping &gt; ₹1 lakh during design incurs charges via discount reduction; no descoping post production or during installation.
              </li>
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900">Delivery &amp; Installation</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm space-y-2">
            <p>Delivery and installation occur on/before the timeline communicated via email, at the provided address.</p>
            <p>Delivery date calculated post the following "All-Set-Go" conditions:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Both parties sign off final designs &amp; specifications.</li>
              <li>Site readiness checklist met; additional unloading charges may apply if no lift is available.</li>
              <li>All milestone payments received and acknowledged by HUB.</li>
              <li>Customer hands over site meeting all contractual conditions.</li>
              <li>Customer agrees not to solicit vendors outside HUB's approved scope without written consent.</li>
            </ul>
            <p className="text-sm text-zinc-600">
              * Disclaiming of Liability: HUB is not liable for products/services from non-approved vendors or where approved vendors act outside assigned scope. Any third-party arrangements are at the customer's risk and lie outside HUB's warranty.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-zinc-900">Disclaimer of Liability</h3>
        <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm">
          HUB shall not be liable in any manner for any products or services provided by vendors, contractors, or agencies who are referred to the customer but are not formally registered as approved vendors with HUB, or where approved vendors act outside their allocated scope. All quotations, negotiations, payments, commitments, or arrangements with such third parties are at the customer's own risk. HUB's warranty and service obligations do not extend to such products or services, and no statement or referral shall be construed as binding on HUB.
        </p>
      </section>
    </div>
    );
  }
);

PreviewContent.displayName = "PreviewContent";

function toPdfFilename(original: string) {
  const base = original.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-_]+/gi, "_");
  return `${base || "design_summary"}.pdf`;
}

export default function Home() {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [preview, setPreview] = useState<PreviewRoom[] | null>(null);
  const [metadata, setMetadata] = useState<QuoteMetadata | null>(null);
  const [summary, setSummary] = useState<QuoteSummary | null>(null);
  const [pdfFilename, setPdfFilename] = useState("design_summary.pdf");
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const computedProjectTotal = useMemo(() => {
    if (!preview) {
      return 0;
    }
    return preview.reduce((roomSum, room) => {
      return (
        roomSum +
        room.types.reduce((typeSum, type) => typeSum + (type.stats.total ?? 0), 0)
      );
    }, 0);
  }, [preview]);

  const aggregatedProjectTotal = useMemo(() => {
    if (summary?.totalPayable && !Number.isNaN(summary.totalPayable)) {
      return summary.totalPayable;
    }
    return computedProjectTotal;
  }, [summary, computedProjectTotal]);

  const formatNumber = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    []
  );

  const formatCurrency = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    []
  );

  const uploadFileInChunks = useCallback(async (file: File): Promise<string> => {
    const chunkSize = 3 * 1024 * 1024; // 3MB chunks (safe for Vercel)
    const totalChunks = Math.ceil(file.size / chunkSize);
    const uploadId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Upload chunks sequentially
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      const chunkFormData = new FormData();
      chunkFormData.append("chunk", chunk);
      chunkFormData.append("chunkIndex", i.toString());
      chunkFormData.append("totalChunks", totalChunks.toString());
      chunkFormData.append("uploadId", uploadId);
      chunkFormData.append("fileName", file.name);

      const response = await fetch("/api/upload-chunk", {
        method: "POST",
        body: chunkFormData,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Chunk upload failed" }));
        throw new Error(error.error || `Failed to upload chunk ${i + 1} of ${totalChunks}`);
      }

      const result = await response.json();
      if (result.complete) {
        return uploadId;
      }

      // Update status for progress
      setStatus({
        state: "uploading",
        message: `Uploading... ${i + 1} of ${totalChunks} chunks`,
      } as Status);
    }

    // Wait a bit for the last chunk to be processed
    await new Promise((resolve) => setTimeout(resolve, 500));
    return uploadId;
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const file = formData.get("file");

      if (!(file instanceof File) || !file.name) {
        setStatus({
          state: "error",
          message: "Please choose an Excel file before converting.",
        });
        return;
      }

      try {
        setStatus({ state: "uploading" });
        setPreview(null);
        setMetadata(null);
        setSummary(null);

        const maxDirectSize = 4 * 1024 * 1024; // 4MB for direct upload
        let uploadId: string | null = null;

        // Use chunked upload for files larger than 4MB
        if (file.size > maxDirectSize) {
          setStatus({
            state: "uploading",
            message: "Uploading file in chunks...",
          } as Status);
          uploadId = await uploadFileInChunks(file);
        }

        // Prepare conversion request
        const convertFormData = new FormData();
        if (uploadId) {
          convertFormData.append("uploadId", uploadId);
        } else {
          convertFormData.append("file", file);
        }

        setStatus({
          state: "uploading",
          message: "Processing file...",
        } as Status);

        const response = await fetch("/api/convert", {
          method: "POST",
          body: convertFormData,
        });

        if (!response.ok) {
          let errorMessage = "Conversion failed. Please try again.";
         
          if (response.status === 413) {
            errorMessage = "File is too large. Please try again or use a smaller file.";
          } else {
            try {
              const data = await response.json();
              errorMessage = data?.error || errorMessage;
            } catch {
              // If JSON parsing fails, use default message
            }
          }
         
          throw new Error(errorMessage);
        }

        const data = await response.json();
        if (!Array.isArray(data?.rooms)) {
          throw new Error("Unexpected response format from server.");
        }

        setPreview(data.rooms as PreviewRoom[]);
        setMetadata((data.meta ?? {}) as QuoteMetadata);
        setSummary((data.summary ?? null) as QuoteSummary | null);
        setPdfFilename(toPdfFilename(file.name));
        setIsPreviewOpen(true);
        setStatus({
          state: "success",
          message: "Preview ready. Review the summary below and download the PDF when ready.",
        });
        form.reset();
      } catch (error) {
        console.error(error);
        setStatus({
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unexpected error. Please try again.",
        });
      }
    },
    [uploadFileInChunks]
  );

  const closePreview = useCallback(() => setIsPreviewOpen(false), []);

  const handleMetaFieldChange = useCallback(
    (field: keyof QuoteMetadata, value: string) => {
      setMetadata((previous) => {
        const next: QuoteMetadata = { ...(previous ?? {}) };
 
        if (field === "discountAmount") {
          const sanitized = value.replace(/[^0-9.]/g, "");
          if (!sanitized) {
            delete (next as Record<string, unknown>)[field];
            return next;
          }
          const numeric = Number(sanitized);
          if (Number.isNaN(numeric)) {
            delete (next as Record<string, unknown>)[field];
          } else {
            (next as Record<string, unknown>)[field] = numeric;
          }
          return next;
        }
 
        if (!value.trim()) {
          delete (next as Record<string, unknown>)[field as string];
        } else {
          (next as Record<string, unknown>)[field as string] = value;
        }
 
        return next;
      });
    },
    []
  );
 
  const handleDownloadPdf = useCallback(async () => {
    if (!previewRef.current || !preview || !preview.length) {
      setStatus({
        state: "error",
        message: "Upload a workbook and generate the preview before downloading.",
      });
      return;
    }
 
    try {
      // Ensure preview is open and wait for it to render
      if (!isPreviewOpen) {
        setIsPreviewOpen(true);
        // Wait longer for the modal to fully render
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        // Even if open, wait a bit for any pending renders
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
 
      setIsGeneratingPdf(true);
      const element = previewRef.current;
     
      // Ensure element is visible and has dimensions
      if (!element || element.offsetWidth === 0 || element.offsetHeight === 0) {
        throw new Error("Preview element is not visible or has no dimensions. Please ensure the preview is fully loaded.");
      }
 
      let canvas: HTMLCanvasElement;
      let cleanup: (() => void) | null = null;
     
      try {
        const { clone, cleanup: cleanupFn } = createPrintableClone(element);
        cleanup = cleanupFn;
        const target = clone;
       
        // Wait for fonts to load and clone to be fully rendered
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        
        // Final aggressive pass to convert all LAB colors before html2canvas
        convertAllColorsInElement(target);
        
        // CRITICAL: Force all discount rows to be visible before PDF generation
        const discountRowsInClone = target.querySelectorAll('tr.discount-row, tr[data-discount-row="true"]');
        discountRowsInClone.forEach((row) => {
          if (row instanceof HTMLElement) {
            // Check if row has content (discount value)
            const lastCell = row.querySelector('td:last-child');
            const hasContent = lastCell && lastCell.textContent && 
                               lastCell.textContent.trim() !== '' && 
                               !lastCell.textContent.trim().match(/^[\s-]*$/);
            
            if (hasContent) {
              row.style.display = 'table-row';
              row.style.setProperty('display', 'table-row', 'important');
              row.style.visibility = 'visible';
              row.style.setProperty('visibility', 'visible', 'important');
              row.style.opacity = '1';
              row.style.setProperty('opacity', '1', 'important');
              row.style.position = 'static';
              row.style.height = 'auto';
              
              // Force all cells visible
              const cells = row.querySelectorAll('td, th');
              cells.forEach((cell) => {
                if (cell instanceof HTMLElement) {
                  cell.style.display = 'table-cell';
                  cell.style.setProperty('display', 'table-cell', 'important');
                  cell.style.visibility = 'visible';
                  cell.style.setProperty('visibility', 'visible', 'important');
                  cell.style.opacity = '1';
                  cell.style.setProperty('opacity', '1', 'important');
                }
              });
            }
          }
        });
        
        // CRITICAL: Force all discount cards to be visible before PDF generation
        const discountCardsInClone = target.querySelectorAll('.discount-card, [data-discount-card="true"]');
        discountCardsInClone.forEach((card) => {
          if (card instanceof HTMLElement) {
            // Always show the card if it exists
            card.style.display = 'block';
            card.style.setProperty('display', 'block', 'important');
            card.style.visibility = 'visible';
            card.style.setProperty('visibility', 'visible', 'important');
            card.style.opacity = '1';
            card.style.setProperty('opacity', '1', 'important');
            card.style.position = 'relative';
            card.style.height = 'auto';
            card.style.width = 'auto';
            
            // Force ALL direct children and nested elements to be visible
            const allChildren = card.querySelectorAll('*');
            allChildren.forEach((child) => {
              if (child instanceof HTMLElement) {
                // Force visibility on ALL elements
                child.style.visibility = 'visible';
                child.style.setProperty('visibility', 'visible', 'important');
                child.style.opacity = '1';
                child.style.setProperty('opacity', '1', 'important');
                if (child.style.display === 'none' || child.style.display === '') {
                  child.style.display = 'block';
                  child.style.setProperty('display', 'block', 'important');
                }
                
                // Special handling for h4 titles
                if (child.tagName === 'H4') {
                  child.style.display = 'block';
                  child.style.setProperty('display', 'block', 'important');
                  child.style.visibility = 'visible';
                  child.style.setProperty('visibility', 'visible', 'important');
                  child.style.opacity = '1';
                  child.style.setProperty('opacity', '1', 'important');
                  try {
                    const computedStyle = window.getComputedStyle(child);
                    let color = computedStyle.color;
                    if (color && (color.includes('rgba') || color.includes('rgb'))) {
                      child.style.color = color;
                      child.style.setProperty('color', color, 'important');
                    } else {
                      child.style.color = '#1e40af';
                      child.style.setProperty('color', '#1e40af', 'important');
                    }
                    if (computedStyle.fontSize) child.style.fontSize = computedStyle.fontSize;
                    if (computedStyle.fontWeight) child.style.fontWeight = computedStyle.fontWeight;
                    if (computedStyle.textTransform) child.style.textTransform = computedStyle.textTransform;
                  } catch (e) {
                    child.style.color = '#1e40af';
                    child.style.fontSize = '0.75rem';
                    child.style.fontWeight = '600';
                    child.style.textTransform = 'uppercase';
                  }
                }
                
                // Special handling for all paragraphs
                if (child.tagName === 'P') {
                  child.style.display = 'block';
                  child.style.setProperty('display', 'block', 'important');
                  child.style.visibility = 'visible';
                  child.style.setProperty('visibility', 'visible', 'important');
                  child.style.opacity = '1';
                  child.style.setProperty('opacity', '1', 'important');
                  try {
                    const computedStyle = window.getComputedStyle(child);
                    let color = computedStyle.color;
                    if (color && (color.includes('rgba') || color.includes('rgb'))) {
                      child.style.color = color;
                      child.style.setProperty('color', color, 'important');
                    } else {
                      child.style.color = '#1e40af';
                      child.style.setProperty('color', '#1e40af', 'important');
                    }
                    if (computedStyle.fontSize) child.style.fontSize = computedStyle.fontSize;
                    if (computedStyle.fontWeight) child.style.fontWeight = computedStyle.fontWeight;
                  } catch (e) {
                    const text = child.textContent?.trim() || '';
                    if (text.includes('₹') && text.length > 5) {
                      child.style.color = '#1e40af';
                      child.style.fontSize = '1.875rem';
                      child.style.fontWeight = '700';
                    } else {
                      child.style.color = '#1e40af';
                      child.style.fontSize = '0.75rem';
                    }
                  }
                }
              }
            });
          }
        });
        
        // Also ensure Total Payable card is visible
        const discountSection = target.querySelector('[data-discount-section="true"]');
        if (discountSection) {
          const allCards = discountSection.querySelectorAll('div[class*="rounded-3xl"]');
          allCards.forEach((card) => {
            if (card instanceof HTMLElement) {
              card.style.display = 'block';
              card.style.setProperty('display', 'block', 'important');
              card.style.visibility = 'visible';
              card.style.setProperty('visibility', 'visible', 'important');
              card.style.opacity = '1';
              card.style.setProperty('opacity', '1', 'important');
              const children = card.querySelectorAll('*');
              children.forEach((child) => {
                if (child instanceof HTMLElement) {
                  child.style.visibility = 'visible';
                  child.style.setProperty('visibility', 'visible', 'important');
                  child.style.opacity = '1';
                  child.style.setProperty('opacity', '1', 'important');
                  if (child.style.display === 'none') {
                    child.style.display = 'block';
                    child.style.setProperty('display', 'block', 'important');
                  }
                }
              });
            }
          });
        }
        
        // Force a style recalculation to ensure all styles are applied
        if (target.offsetHeight) {
          void target.offsetHeight; // Force reflow
        }
        
        // Ensure clone has proper dimensions
        if (target.offsetWidth === 0 || target.offsetHeight === 0) {
          throw new Error("Clone element has no dimensions");
        }
       
        canvas = await html2canvas(target, {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: "#ffffff",
          logging: false,
          width: target.scrollWidth || target.offsetWidth,
          height: target.scrollHeight || target.offsetHeight,
          windowWidth: target.scrollWidth || target.offsetWidth,
          windowHeight: target.scrollHeight || target.offsetHeight,
          removeContainer: true,
          imageTimeout: 15000,
          onclone: (clonedDoc) => {
            // Convert all LAB/OKLab colors in the cloned document using comprehensive function
            // Find the cloned element in the cloned document
            const clonedElement = clonedDoc.querySelector('.__pdf-clone') || clonedDoc.body;
            if (clonedElement instanceof HTMLElement) {
              // Use our comprehensive color conversion function
              convertAllColorsInElement(clonedElement);
              
              // Also convert all other elements
              const allElements = clonedDoc.querySelectorAll('*');
              allElements.forEach((el) => {
                if (el instanceof HTMLElement && el !== clonedElement) {
                  convertAllColorsInElement(el);
                }
              });
              
              // Force style recalculation
              if (clonedDoc.body instanceof HTMLElement) {
                convertAllColorsInElement(clonedDoc.body);
              }
              
              // CRITICAL: Explicitly ensure discount rows are visible - check for content first
              const discountRows = clonedDoc.querySelectorAll('tr.discount-row, tr[data-discount-row="true"]');
              discountRows.forEach((row) => {
                if (row instanceof HTMLElement) {
                  // Check if row has discount value content
                  const lastCell = row.querySelector('td:last-child');
                  const hasContent = lastCell && lastCell.textContent && 
                                   lastCell.textContent.trim() !== '' && 
                                   lastCell.textContent.trim() !== '-' &&
                                   !lastCell.textContent.trim().match(/^[\s₹,-]*$/);
                  
                  // Force visibility if content exists
                  if (hasContent) {
                    row.style.display = 'table-row';
                    row.style.setProperty('display', 'table-row', 'important');
                    row.style.visibility = 'visible';
                    row.style.setProperty('visibility', 'visible', 'important');
                    row.style.opacity = '1';
                    row.style.setProperty('opacity', '1', 'important');
                    row.style.position = 'static';
                    row.style.height = 'auto';
                    row.style.removeProperty('display'); // Remove display:none if present
                    
                    // Ensure all cells are visible and preserve alignment
                    const cells = row.querySelectorAll('td, th');
                    cells.forEach((cell) => {
                      if (cell instanceof HTMLElement) {
                        cell.style.display = 'table-cell';
                        cell.style.setProperty('display', 'table-cell', 'important');
                        cell.style.visibility = 'visible';
                        cell.style.setProperty('visibility', 'visible', 'important');
                        cell.style.opacity = '1';
                        cell.style.setProperty('opacity', '1', 'important');
                        // Preserve text alignment from computed styles
                        try {
                          const computedCellStyle = window.getComputedStyle(cell);
                          if (computedCellStyle.textAlign) {
                            cell.style.textAlign = computedCellStyle.textAlign;
                            cell.style.setProperty('text-align', computedCellStyle.textAlign, 'important');
                          }
                        } catch (e) {
                          // Ignore errors
                        }
                      }
                    });
                    
                    // Ensure nested flex divs maintain alignment
                    const innerDivs = row.querySelectorAll('div');
                    innerDivs.forEach((div) => {
                      if (div instanceof HTMLElement) {
                        div.style.display = 'flex';
                        div.style.setProperty('display', 'flex', 'important');
                        try {
                          const computedDivStyle = window.getComputedStyle(div);
                          if (computedDivStyle.justifyContent) {
                            div.style.justifyContent = computedDivStyle.justifyContent;
                            div.style.setProperty('justify-content', computedDivStyle.justifyContent, 'important');
                          }
                          if (computedDivStyle.alignItems) {
                            div.style.alignItems = computedDivStyle.alignItems;
                            div.style.setProperty('align-items', computedDivStyle.alignItems, 'important');
                          }
                        } catch (e) {
                          // Ignore errors, use defaults
                          div.style.justifyContent = 'flex-end';
                        }
                      }
                    });
                  }
                }
              });
              
              // CRITICAL: Explicitly ensure discount cards are visible
              const discountCards = clonedDoc.querySelectorAll('.discount-card, [data-discount-card="true"]');
              discountCards.forEach((card) => {
                if (card instanceof HTMLElement) {
                  // Always show the card if it exists - don't check for content first
                  card.style.display = 'block';
                  card.style.setProperty('display', 'block', 'important');
                  card.style.visibility = 'visible';
                  card.style.setProperty('visibility', 'visible', 'important');
                  card.style.opacity = '1';
                  card.style.setProperty('opacity', '1', 'important');
                  card.style.position = 'relative';
                  card.style.height = 'auto';
                  card.style.width = 'auto';
                  
                  // Force ALL direct children and nested elements to be visible
                  const allChildren = card.querySelectorAll('*');
                  allChildren.forEach((child) => {
                    if (child instanceof HTMLElement) {
                      // Force visibility on ALL elements
                      child.style.visibility = 'visible';
                      child.style.setProperty('visibility', 'visible', 'important');
                      child.style.opacity = '1';
                      child.style.setProperty('opacity', '1', 'important');
                      if (child.style.display === 'none' || child.style.display === '') {
                        child.style.display = 'block';
                        child.style.setProperty('display', 'block', 'important');
                      }
                      
                      // Special handling for h4 titles
                      if (child.tagName === 'H4') {
                        child.style.display = 'block';
                        child.style.setProperty('display', 'block', 'important');
                        child.style.visibility = 'visible';
                        child.style.setProperty('visibility', 'visible', 'important');
                        child.style.opacity = '1';
                        child.style.setProperty('opacity', '1', 'important');
                        try {
                          const computedStyle = window.getComputedStyle(child);
                          // Force text color - convert opacity colors to solid
                          let color = computedStyle.color;
                          if (color && (color.includes('rgba') || color.includes('rgb'))) {
                            child.style.color = color;
                            child.style.setProperty('color', color, 'important');
                          } else {
                            // Use dark blue for discount card titles
                            child.style.color = '#1e40af';
                            child.style.setProperty('color', '#1e40af', 'important');
                          }
                          if (computedStyle.fontSize) {
                            child.style.fontSize = computedStyle.fontSize;
                          }
                          if (computedStyle.fontWeight) {
                            child.style.fontWeight = computedStyle.fontWeight;
                          }
                          if (computedStyle.textTransform) {
                            child.style.textTransform = computedStyle.textTransform;
                          }
                        } catch (e) {
                          child.style.color = '#1e40af';
                          child.style.fontSize = '0.75rem';
                          child.style.fontWeight = '600';
                          child.style.textTransform = 'uppercase';
                        }
                      }
                      
                      // Special handling for all paragraphs (amount and description)
                      if (child.tagName === 'P') {
                        child.style.display = 'block';
                        child.style.setProperty('display', 'block', 'important');
                        child.style.visibility = 'visible';
                        child.style.setProperty('visibility', 'visible', 'important');
                        child.style.opacity = '1';
                        child.style.setProperty('opacity', '1', 'important');
                        try {
                          const computedStyle = window.getComputedStyle(child);
                          // Force text color
                          let color = computedStyle.color;
                          if (color && (color.includes('rgba') || color.includes('rgb'))) {
                            child.style.color = color;
                            child.style.setProperty('color', color, 'important');
                          } else {
                            // Use dark blue for discount card text
                            child.style.color = '#1e40af';
                            child.style.setProperty('color', '#1e40af', 'important');
                          }
                          if (computedStyle.fontSize) {
                            child.style.fontSize = computedStyle.fontSize;
                          }
                          if (computedStyle.fontWeight) {
                            child.style.fontWeight = computedStyle.fontWeight;
                          }
                        } catch (e) {
                          // Fallback - check if it's the large amount or description
                          const text = child.textContent?.trim() || '';
                          if (text.includes('₹') && text.length > 5) {
                            // Large amount
                            child.style.color = '#1e40af';
                            child.style.fontSize = '1.875rem';
                            child.style.fontWeight = '700';
                          } else {
                            // Description
                            child.style.color = '#1e40af';
                            child.style.fontSize = '0.75rem';
                          }
                        }
                      }
                    }
                  });
                }
              });
              
              // Also ensure Total Payable card is visible and styled correctly (it's in the same section)
              const discountSection = clonedDoc.querySelector('[data-discount-section="true"]');
              if (discountSection) {
                const allCards = discountSection.querySelectorAll('div[class*="rounded-3xl"]');
                allCards.forEach((card) => {
                  if (card instanceof HTMLElement) {
                    // Check if this is the total payable card (has emerald background)
                    const isTotalPayable = card.classList.contains('bg-emerald-50') || 
                                         card.style.backgroundColor?.includes('emerald') ||
                                         !card.classList.contains('discount-card') && !card.hasAttribute('data-discount-card');
                    
                    card.style.display = 'block';
                    card.style.setProperty('display', 'block', 'important');
                    card.style.visibility = 'visible';
                    card.style.setProperty('visibility', 'visible', 'important');
                    card.style.opacity = '1';
                    card.style.setProperty('opacity', '1', 'important');
                    // Force all children visible
                    const children = card.querySelectorAll('*');
                    children.forEach((child) => {
                      if (child instanceof HTMLElement) {
                        child.style.visibility = 'visible';
                        child.style.setProperty('visibility', 'visible', 'important');
                        child.style.opacity = '1';
                        child.style.setProperty('opacity', '1', 'important');
                        if (child.style.display === 'none') {
                          child.style.display = 'block';
                          child.style.setProperty('display', 'block', 'important');
                        }
                        
                        // Apply dark green color to total payable card text
                        if (isTotalPayable) {
                          try {
                            const computedStyle = window.getComputedStyle(child);
                            let color = computedStyle.color;
                            if (color && (color.includes('rgba') || color.includes('rgb'))) {
                              child.style.color = color;
                              child.style.setProperty('color', color, 'important');
                            } else {
                              // Use dark green for total payable card text
                              child.style.color = '#166534';
                              child.style.setProperty('color', '#166534', 'important');
                            }
                          } catch (e) {
                            child.style.color = '#166534';
                            child.style.setProperty('color', '#166534', 'important');
                          }
                        }
                      }
                    });
                  }
                });
              }
              
              // Ensure font styles are preserved
              try {
                const computedStyle = getComputedStyle(target);
                clonedElement.style.fontFamily = computedStyle.fontFamily;
                clonedElement.style.fontSize = computedStyle.fontSize;
                clonedElement.style.lineHeight = computedStyle.lineHeight;
                clonedElement.style.fontWeight = computedStyle.fontWeight;
                // Force reflow to ensure styles are applied
                clonedElement.offsetHeight;
              } catch (error) {
                console.warn("Error setting font styles:", error);
              }
            }
          },
        });
      } catch (cloneError) {
        console.warn("Failed to use clone, falling back to original element:", cloneError);
        if (cleanup) {
          cleanup();
          cleanup = null;
        }
        // Wait for fonts to load
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
       
        // Fallback to using the original element directly
        canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: "#ffffff",
          logging: false,
          width: element.scrollWidth || element.offsetWidth,
          height: element.scrollHeight || element.offsetHeight,
          windowWidth: element.scrollWidth || element.offsetWidth,
          windowHeight: element.scrollHeight || element.offsetHeight,
          removeContainer: true,
          imageTimeout: 15000,
          onclone: (clonedDoc) => {
            // Convert all LAB/OKLab colors in the cloned document
            const convertAllColors = (el: HTMLElement) => {
              try {
                const elStyle = window.getComputedStyle(el);
                
                // Convert color
                const color = normalizeColor(elStyle.color, "color");
                if (color && !/(lab|oklab)\(/i.test(color)) {
                  el.style.color = color;
                } else {
                  el.style.color = "black";
                }
                
                // Convert backgroundColor
                const bgColor = normalizeColor(elStyle.backgroundColor, "backgroundColor");
                if (bgColor && !/(lab|oklab)\(/i.test(bgColor)) {
                  el.style.backgroundColor = bgColor;
                } else {
                  el.style.backgroundColor = "white";
                }
                
                // Convert borderColor
                const borderColor = normalizeColor(elStyle.borderColor, "borderColor");
                if (borderColor && !/(lab|oklab)\(/i.test(borderColor)) {
                  el.style.borderColor = borderColor;
                }
                
                // Convert other color properties
                const textShadow = normalizeColor(elStyle.textShadow, "textShadow");
                if (textShadow && !/(lab|oklab)\(/i.test(textShadow)) {
                  el.style.textShadow = textShadow;
                }
                
                const boxShadow = normalizeColor(elStyle.boxShadow, "boxShadow");
                if (boxShadow && !/(lab|oklab)\(/i.test(boxShadow)) {
                  el.style.boxShadow = boxShadow;
                }
              } catch (error) {
                console.warn("Error converting colors:", error);
              }
            };
            
            // Convert colors for all elements
            const allElements = clonedDoc.querySelectorAll('*');
            allElements.forEach((el) => {
              if (el instanceof HTMLElement) {
                convertAllColors(el);
              }
            });
            
            // Also convert for body
            if (clonedDoc.body instanceof HTMLElement) {
              convertAllColors(clonedDoc.body);
            }
            
            const clonedElement = clonedDoc.querySelector('.__pdf-clone') || clonedDoc.body;
            if (clonedElement instanceof HTMLElement) {
              try {
                const computedStyle = getComputedStyle(element);
                clonedElement.style.fontFamily = computedStyle.fontFamily;
                clonedElement.style.fontSize = computedStyle.fontSize;
                clonedElement.style.lineHeight = computedStyle.lineHeight;
                clonedElement.style.fontWeight = computedStyle.fontWeight;
                // Force reflow to ensure styles are applied
                clonedElement.offsetHeight;
              } catch (error) {
                console.warn("Error setting font styles:", error);
              }
            }
          },
        });
      } finally {
        if (cleanup) {
          cleanup();
        }
      }
 
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error("Failed to capture the preview. The canvas is empty.");
      }
 
      // Use higher quality for better text rendering
      const imgData = canvas.toDataURL("image/png", 1.0);
     
      if (!imgData || imgData === "data:,") {
        throw new Error("Failed to convert canvas to image data.");
      }

      // Create PDF with proper dimensions
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
        compress: true,
      });
     
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 0; // No margin for full page
      const contentWidth = pageWidth - (margin * 2);
     
      // Calculate image dimensions maintaining aspect ratio
      const imgWidth = contentWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      // Calculate how many pages we need
      const totalPages = Math.ceil(imgHeight / pageHeight);
     
      // Add content to each page without overlapping
      for (let page = 0; page < totalPages; page++) {
        if (page > 0) {
          pdf.addPage();
        }
       
        // Calculate the y position for this page
        // For page 0: start at 0
        // For page 1: start at -pageHeight (showing the part that was cut off)
        // For page 2: start at -2*pageHeight, etc.
        const yPosition = -page * pageHeight;
       
        // Only add the image if there's content to show on this page
        if (yPosition + imgHeight > 0) {
          pdf.addImage(
            imgData,
            "PNG",
            margin,
            yPosition,
            imgWidth,
            imgHeight,
            undefined,
            "FAST"
          );
        }
      }
 
      pdf.save(pdfFilename);
      setStatus({
        state: "success",
        message: "PDF generated successfully.",
      });
    } catch (error) {
      console.error("PDF generation failed", error);
      const errorMessage = error instanceof Error
        ? error.message
        : "Failed to generate the PDF. Please try again.";
      setStatus({
        state: "error",
        message: errorMessage,
      });
    } finally {
      document.querySelectorAll(".__pdf-clone").forEach((node) => {
        if (node instanceof HTMLElement) {
          node.remove();
        }
      });
      setIsGeneratingPdf(false);
    }
  }, [pdfFilename, preview, isPreviewOpen]);
 
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-16 font-sans">
      <main className="w-full max-w-5xl space-y-10 rounded-3xl bg-white p-10 shadow-xl">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold">Excel to PDF Designer Summary</h1>
          <p className="text-base text-zinc-600">
            Upload an Excel workbook (.xlsx or .xls) and we parse every worksheet into a
            structured summary grouped by room and cabinet type. Preview the result below and
            download it as a formatted PDF.
          </p>
        </header>
 
        <section>
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-6 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 p-6 text-sm"
          >
            <label
              htmlFor="file"
              className="flex flex-col gap-1 text-left text-base font-medium"
            >
              Select Excel file
              <input
                id="file"
                name="file"
                type="file"
                accept=".xls,.xlsx,.xlsm"
                className="mt-1 w-full cursor-pointer rounded-xl border border-zinc-300 bg-white p-3 text-sm text-zinc-700 transition hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-xs font-normal text-zinc-400">
                Data stays in this session; we only derive the preview needed to build your PDF.
                <br />
                Files up to 4MB upload directly. Larger files use chunked upload automatically.
              </span>
            </label>
 
            <button
              type="submit"
              className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={status.state === "uploading"}
            >
              {status.state === "uploading" ? "Processing…" : "Generate Preview"}
            </button>
          </form>
        </section>
 
        {status.state === "error" && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            {status.message}
          </p>
        )}
        {status.state === "success" && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            {status.message}
          </p>
        )}
 
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Preview</h2>
              <p className="text-sm text-zinc-600">
                Generate a preview to review the full designer summary and download it as a PDF.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setIsPreviewOpen(true)}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-4 focus:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!preview || !preview.length}
              >
                Open Full Page Preview
              </button>
              <button
                type="button"
                onClick={handleDownloadPdf}
                className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!preview || !preview.length || isGeneratingPdf}
              >
                {isGeneratingPdf ? "Preparing PDF…" : `Download PDF (${pdfFilename})`}
              </button>
            </div>
          </div>
 
          {!preview || !preview.length ? (
            <div className="mt-6 rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
              Upload a workbook to enable preview actions.
            </div>
          ) : (
            <div className="mt-6 rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-6 text-sm text-emerald-700">
              Preview generated. Use the buttons above to open the full-page view or download the PDF.
            </div>
          )}
        </section>
 
        {metadata && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Customize Quotation Header</h2>
                <p className="text-sm text-zinc-600">
                  Update any of the fields below to fine-tune the preview content before exporting.
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {METADATA_FIELDS.map(({ field, label, multiline, fullWidth }) => {
                const rawValue = metadata
                  ? (metadata as Record<string, unknown>)[field as string]
                  : undefined;
                const isNumeric =
                  field === "discountAmount";
                const value = isNumeric
                  ? rawValue != null
                    ? String(rawValue)
                    : ""
                  : rawValue != null
                  ? String(rawValue)
                  : "";
                const commonProps = {
                  id: field,
                  name: field,
                  value,
                  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                    handleMetaFieldChange(field, event.target.value),
                  className:
                    "mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm transition hover:border-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200",
                  placeholder: label,
                  type: isNumeric ? "number" : "text",
                  inputMode: isNumeric ? ("decimal" as const) : undefined,
                  step: isNumeric ? "0.01" : undefined,
                };

                const { type, inputMode, step, ...textAreaProps } = commonProps;
                const inputProps = { type, inputMode, step, ...textAreaProps };

                return (
                  <label
                    key={field}
                    className={`flex flex-col rounded-2xl border border-transparent bg-zinc-50 p-4 text-sm ${
                      fullWidth ? "md:col-span-2 lg:col-span-3" : ""
                    }`}
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      {label}
                    </span>
                    {multiline ? (
                      <textarea rows={3} {...textAreaProps} />
                    ) : (
                      <input {...inputProps} />
                    )}
                  </label>
                );
              })}
        </div>
          </section>
        )}
      </main>
 
      {preview && preview.length ? (
        <div
          className={`fixed inset-0 z-50 flex items-stretch justify-center transition duration-200 ${
            isPreviewOpen ? "pointer-events-auto" : "pointer-events-none"
          }`}
        >
          <div
            className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
              isPreviewOpen ? "opacity-100" : "opacity-0"
            }`}
            onClick={closePreview}
          />
          <div
            className={`relative z-10 mt-6 mb-6 flex w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl transition-all duration-200 ${
              isPreviewOpen ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
            }`}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/95 px-6 py-4 backdrop-blur">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">
                  Designer Summary Preview
                </h2>
                <p className="text-xs text-zinc-500">
                  Review the parsed workbook below. Use the buttons to download or close the preview.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isGeneratingPdf}
                >
                  {isGeneratingPdf ? "Preparing PDF…" : "Download PDF"}
                </button>
                <button
                  type="button"
                  onClick={closePreview}
                  className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-300"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <PreviewContent
                ref={previewRef}
                meta={metadata}
                rooms={preview}
                summary={summary}
                formatNumber={formatNumber}
                formatCurrency={formatCurrency}
                onMetaChange={handleMetaFieldChange}
                projectTotal={aggregatedProjectTotal}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}