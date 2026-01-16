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

// --- Types ---

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
  worktops: number;
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

// --- Helper Components & Functions ---

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

    if (Number.isNaN(L) || Number.isNaN(a) || Number.isNaN(b)) {
      return lab;
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

    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(bl)) {
      return lab;
    }

    if (alpha < 1) {
      return `rgba(${to255(r)}, ${to255(g)}, ${to255(bl)}, ${clamp(alpha)})`;
    }

    return `rgb(${to255(r)}, ${to255(g)}, ${to255(bl)})`;
  } catch (error) {
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

    if (Number.isNaN(L) || Number.isNaN(a) || Number.isNaN(b)) {
      return oklab;
    }

    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;

    let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    let bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

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
   
  const hasUnsupportedColor = /(lab|oklab)\(/i.test(value);
  if (!hasUnsupportedColor) {
    return value;
  }
   
  try {
    let normalized = value.replace(/oklab\([^)]*\)/gi, (match) => {
      try {
        const converted = oklabToRgb(match);
        if (converted === match) {
          if (property === "backgroundColor" || property === "background") return "white";
          else if (property === "color") return "black";
          else if (property === "borderColor" || property === "border") return "currentColor";
          return "transparent";
        }
        return converted;
      } catch (error) {
        if (property === "backgroundColor" || property === "background") return "white";
        else if (property === "color") return "black";
        return "transparent";
      }
    });
    
    normalized = normalized.replace(/lab\([^)]*\)/gi, (match) => {
      try {
        const converted = labToRgb(match);
        if (converted === match) {
          if (property === "backgroundColor" || property === "background") return "white";
          else if (property === "color") return "black";
          else if (property === "borderColor" || property === "border") return "currentColor";
          return "transparent";
        }
        return converted;
      } catch (error) {
        if (property === "backgroundColor" || property === "background") return "white";
        else if (property === "color") return "black";
        return "transparent";
      }
    });

    return normalized;
  } catch (error) {
    if (property === "backgroundColor" || property === "background") return "white";
    else if (property === "color") return "black";
    return value;
  }
}

function convertAllColorsInElement(element: HTMLElement) {
  try {
    const style = window.getComputedStyle(element);
    const colorProps = ['color', 'backgroundColor', 'background', 'borderColor',
                        'borderTopColor', 'borderRightColor', 'borderBottomColor',
                        'borderLeftColor', 'border', 'borderTop', 'borderRight',
                        'borderBottom', 'borderLeft', 'outlineColor', 'outline',
                        'textShadow', 'boxShadow', 'columnRuleColor'] as const;
    
    colorProps.forEach((prop) => {
      try {
        let value = style.getPropertyValue(prop);
        if (!value) {
          const camelProp = prop.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
          value = (style as any)[camelProp];
        }
        
        if (value && typeof value === 'string') {
          if ((prop === 'textShadow' || prop === 'boxShadow') && /(lab|oklab)\(/i.test(value)) {
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
          else if ((prop === 'border' || prop.startsWith('border')) && !(prop as string).includes('Color') && /(lab|oklab)\(/i.test(value)) {
            const borderParts = value.split(/\s+/);
            const hasLabColor = borderParts.some(part => /(lab|oklab)\(/i.test(part));
            if (hasLabColor) {
              const width = borderParts.find(part => /^\d/.test(part)) || '1px';
              const styleType = borderParts.find(part => ['solid', 'dashed', 'dotted', 'double', 'none'].includes(part)) || 'solid';
              element.style.setProperty(prop, `${width} ${styleType} currentColor`, 'important');
            }
          }
          else if (/(lab|oklab)\(/i.test(value) || (prop as string).includes('Color')) {
            const normalized = normalizeColor(value, prop);
            if (normalized && !/(lab|oklab)\(/i.test(normalized)) {
              element.style.setProperty(prop, normalized, 'important');
            } else {
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
        try {
          if (prop === 'backgroundColor' || prop === 'background') {
            element.style.setProperty('backgroundColor', 'white', 'important');
          } else if (prop === 'color') {
            element.style.setProperty('color', 'black', 'important');
          }
        } catch (fallbackError) {
          // Ignore
        }
      }
    });
  } catch (error) {
    try {
      element.style.setProperty('color', 'black', 'important');
      element.style.setProperty('backgroundColor', 'white', 'important');
    } catch (fallbackError) {
      // Ignore
    }
  }
   
  Array.from(element.children).forEach((child) => {
    if (child instanceof HTMLElement) {
      convertAllColorsInElement(child);
    }
  });
   
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

  const convertInputsToText = (element: HTMLElement) => {
    const inputs = element.querySelectorAll('input, textarea');
     
    inputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
        return;
      }
      
      const span = document.createElement('span');
      let value = input.value || (input.placeholder && input.placeholder.trim() ? input.placeholder : '');
      value = value.replace(/\s*-\s*$/, '').trim();
      span.textContent = value;
      
      let computedStyle = window.getComputedStyle(input);
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
      
      const normalizedSpanColor = normalizeColor(computedStyle.color, "color");
      span.style.color = normalizedSpanColor && !/(lab|oklab)\(/i.test(normalizedSpanColor) 
        ? normalizedSpanColor 
        : "black";
      
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
      
      span.className = input.className;
      
      if (!value) {
        span.style.minHeight = computedStyle.minHeight || computedStyle.height || '1em';
      }
      
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
      return;
    }
    try {
      const normalizedColor = normalizeColor(style.color, "color");
      if (normalizedColor && !/(lab|oklab)\(/i.test(normalizedColor)) {
        clonedNode.style.color = normalizedColor;
      } else {
        clonedNode.style.color = "black";
      }
      
      const normalizedBg = normalizeColor(style.backgroundColor, "backgroundColor");
      if (normalizedBg && !/(lab|oklab)\(/i.test(normalizedBg)) {
        clonedNode.style.backgroundColor = normalizedBg;
      } else {
        clonedNode.style.backgroundColor = "white";
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

  convertInputsToText(clone);
  
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
  clone.classList.add("__pdf-clone");

  const ensureVisibility = (element: HTMLElement) => {
    const style = window.getComputedStyle(element);
    
    if (style.display === "none" && element.tagName !== 'SCRIPT' && element.tagName !== 'STYLE') {
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
    
    if (element.tagName === 'TR' && (element.classList.contains('discount-row') || element.getAttribute('data-discount-row') === 'true')) {
      const discountCell = element.querySelector('td:last-child');
      const hasDiscountValue = discountCell && discountCell.textContent && 
                               discountCell.textContent.trim() !== '' && 
                               discountCell.textContent.trim() !== '-';
      
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
        element.style.removeProperty('display');
        element.style.removeProperty('visibility');
        element.style.removeProperty('opacity');
        
        Array.from(element.children).forEach((child) => {
          if (child instanceof HTMLElement) {
            child.style.display = 'table-cell';
            child.style.setProperty('display', 'table-cell', 'important');
            child.style.visibility = 'visible';
            child.style.setProperty('visibility', 'visible', 'important');
            child.style.opacity = '1';
            child.style.setProperty('opacity', '1', 'important');
            child.style.removeProperty('display');
            child.style.removeProperty('visibility');
            child.style.removeProperty('opacity');
          }
        });
        
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
    
    if (element.tagName === 'TD' || element.tagName === 'TH') {
      element.style.display = 'table-cell';
      element.style.setProperty('display', 'table-cell', 'important');
      element.style.visibility = 'visible';
      element.style.setProperty('visibility', 'visible', 'important');
      element.style.opacity = '1';
      element.style.setProperty('opacity', '1', 'important');
    }
    
    if (element.classList.contains('discount-card') || element.getAttribute('data-discount-card') === 'true') {
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
        
        const children = element.querySelectorAll('*');
        children.forEach((child) => {
          if (child instanceof HTMLElement) {
            child.style.visibility = 'visible';
            child.style.setProperty('visibility', 'visible', 'important');
            child.style.opacity = '1';
            child.style.setProperty('opacity', '1', 'important');
            if (child.style.display === 'none') {
              child.style.display = '';
              child.style.removeProperty('display');
            }
            
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
            
            if (child === discountAmount || (child.tagName === 'P' && (child.classList.contains('text-3xl') || child.classList.contains('mt-3')))) {
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
                } else {
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
                child.style.color = '#1e40af';
                child.style.fontSize = '1.875rem';
                child.style.fontWeight = '700';
              }
            }
            
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
        element.style.display = 'none';
        element.style.setProperty('display', 'none', 'important');
      }
    }
    
    Array.from(element.children).forEach((child) => {
      if (child instanceof HTMLElement) {
        ensureVisibility(child);
      }
    });
  };
  
  ensureVisibility(clone);

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

// --- Preview Component ---

const PreviewContent = forwardRef<HTMLDivElement, PreviewContentProps>(
  ({ meta: metaProp, rooms, summary, formatNumber, formatCurrency, onMetaChange, projectTotal: projectTotalProp }, ref) => {
    if (summary) {
      // eslint-disable-next-line no-console
      console.log("Room summary from API:", summary);
    }

    // Helper function to remove bracket values (content within parentheses)
    const removeBracketValues = (text: string): string => {
      return text.replace(/\s*\([^)]*\)/g, '').trim();
    };

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
      worktops: number;
      total: number;
    }>((acc, row) => {
      acc.modules += row.modules ?? 0;
      acc.accessories += row.accessories ?? 0;
      acc.appliances += row.appliances ?? 0;
      acc.services += row.services ?? 0;
      acc.furniture += row.furniture ?? 0;
      acc.worktops += row.worktops ?? 0;
      acc.total +=
        row.total ??
        (row.modules ?? 0) +
          (row.accessories ?? 0) +
          (row.appliances ?? 0) +
          (row.services ?? 0) +
          (row.furniture ?? 0) +
          (row.worktops ?? 0);
      return acc;
    }, {
      modules: 0,
      accessories: 0,
      appliances: 0,
      services: 0,
      furniture: 0,
      worktops: 0,
      total: 0,
    });

    const totalBeforeDiscount =
      subtotalValue ?? (roomSummaryRows.length > 0 ? totalsRow.total : null);

    const effectiveDiscountValue =
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
      <>
        <style>{`
          /* Page break prevention for PDF generation */
          section {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
           
          div[class*="rounded-2xl"][class*="border"][class*="bg-zinc-50"],
          div[class*="rounded-2xl"][class*="border"][class*="bg-white"][class*="shadow-sm"] {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
           
          table {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
           
          thead tr,
          tbody tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
           
          h1, h2, h3, h4, h5 {
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
           
          div[class*="border-b"][class*="border-zinc-200"] {
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
           
          div[class*="overflow-hidden"][class*="rounded-2xl"][class*="border"] {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
           
          div[class*="grid"][class*="gap-4"] {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
           
          div[class*="grid"][class*="rounded-3xl"][class*="border"] {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
           
          div[class*="space-y-2"] > h5,
          div[class*="space-y-3"] > h3 {
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
           
          div[class*="space-y-6"] {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        `}</style>
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
            <h2 className="text-base font-semibold text-zinc-900 h-[50px]">Project Details</h2>
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
          <h3 className="text-lg font-semibold text-zinc-900 h-[50px]">Room Summary</h3>
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
                  <th className="px-4 py-3 text-right">Worktops</th>
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
                    <td className="px-4 py-3 text-right">{formatMoney(row.worktops)}</td>
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
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.worktops)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.total)}</td>
                  </tr>
                )}
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
                                  {removeBracketValues(value)}
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
          <p className="text-sm text-zinc-600 h-[50px]">
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
          <p className="text-sm text-zinc-600 h-[50px]">
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
          <p className="text-sm text-zinc-600 h-[50px]">
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
    </>
    );
  }
);

PreviewContent.displayName = "PreviewContent";

function toPdfFilename(original: string) {
  const base = original.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-_]+/gi, "_");
  return `${base || "design_summary"}.pdf`;
}

// --- Main Page Component ---

export default function Home() {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [preview, setPreview] = useState<PreviewRoom[] | null>(null);
  const [metadata, setMetadata] = useState<QuoteMetadata | null>(null);
  const [summary, setSummary] = useState<QuoteSummary | null>(null);
  const [pdfFilename, setPdfFilename] = useState("design_summary.pdf");
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isUploadingToS3, setIsUploadingToS3] = useState(false);
  const [s3Url, setS3Url] = useState<string | null>(null);
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

  // Helper function to generate PDF blob
  const generatePdfBlob = useCallback(async (): Promise<Blob | null> => {
    if (!preview || !preview.length || !previewRef.current) {
      return null;
    }

    const { clone, cleanup } = createPrintableClone(previewRef.current);

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const contentWidth = pageWidth - 2 * margin;
      const safetyBuffer = 10;

      let currentY = margin;

      const getFlattenedElements = (element: HTMLElement): HTMLElement[] => {
        const flatList: HTMLElement[] = [];
        const isWrapper =
          element.tagName === "SECTION" ||
          (element.tagName === "DIV" &&
            (element.className.includes("space-y-6") ||
              element.className.includes("space-y-4") ||
              element.className.includes("space-y-10")));

        const isCard =
          element.className.includes("rounded-2xl") ||
          element.className.includes("rounded-3xl");
        const isHeader = element.className.includes("border-b");
        const isDiscountSection =
          element.getAttribute("data-discount-section") === "true";
        const isContentSection =
          element.className.includes("space-y-2") ||
          element.className.includes("space-y-3");
        const isSectionTitle =
          element.className.includes("space-y-2") &&
          element.querySelector("h2") !== null;

        if (
          isCard ||
          isHeader ||
          isDiscountSection ||
          isContentSection ||
          isSectionTitle
        ) {
          if (element.offsetHeight > 0 || element.textContent?.trim())
            flatList.push(element);
          return flatList;
        }

        if (isWrapper) {
          Array.from(element.children).forEach((child) => {
            if (child instanceof HTMLElement) {
              flatList.push(...getFlattenedElements(child));
            }
          });
          return flatList;
        } else {
          if (element.offsetHeight > 0 || element.textContent?.trim()) {
            flatList.push(element);
          }
        }
        return flatList;
      };

      const elementsToProcess = getFlattenedElements(clone);

      const uniqueElements: HTMLElement[] = [];
      const seen = new Set<HTMLElement>();

      for (const element of elementsToProcess) {
        if (seen.has(element)) continue;

        let isDuplicate = false;
        for (const existing of uniqueElements) {
          if (existing.contains(element) || element.contains(existing)) {
            if (existing.contains(element)) {
              isDuplicate = true;
              break;
            }
            if (element.contains(existing)) {
              const index = uniqueElements.indexOf(existing);
              if (index > -1) {
                uniqueElements.splice(index, 1);
                seen.delete(existing);
              }
            }
          }
        }

        if (!isDuplicate) {
          uniqueElements.push(element);
          seen.add(element);
        }
      }

      uniqueElements.sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return aRect.top - bRect.top;
      });

      const processElement = async (element: HTMLElement) => {
        const hasText =
          element.textContent?.trim() &&
          element.textContent.trim().length > 10;
        const hasVisibleContent =
          element.offsetHeight > 0 || hasText;
        if (!hasVisibleContent || (element.offsetHeight < 5 && !hasText))
          return;

        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
          windowWidth: 1200,
        });

        const imgData = canvas.toDataURL("image/png");
        const imgProps = pdf.getImageProperties(imgData);
        const pdfImgHeight = (imgProps.height * contentWidth) / imgProps.width;

        if (currentY + pdfImgHeight + safetyBuffer > pageHeight - margin) {
          if (currentY > margin) {
            pdf.addPage();
            currentY = margin;
          }
        }

        if (pdfImgHeight > pageHeight - 2 * margin) {
          let heightLeft = pdfImgHeight;

          pdf.addImage(
            imgData,
            "PNG",
            margin,
            currentY,
            contentWidth,
            pdfImgHeight
          );
          const printedOnFirstPage = pageHeight - margin - currentY;
          heightLeft -= printedOnFirstPage;

          while (heightLeft > 0) {
            pdf.addPage();
            currentY = margin;

            const yOffset = -1 * (pdfImgHeight - heightLeft) + margin;

            pdf.addImage(
              imgData,
              "PNG",
              margin,
              yOffset,
              contentWidth,
              pdfImgHeight
            );
            heightLeft -= pageHeight - 2 * margin;
          }

          currentY = margin;
        } else {
          pdf.addImage(
            imgData,
            "PNG",
            margin,
            currentY,
            contentWidth,
            pdfImgHeight
          );
          currentY += pdfImgHeight + 5;
        }
      };

      for (const element of uniqueElements) {
        await processElement(element);
      }

      return pdf.output("blob");
    } finally {
      cleanup();
    }
  }, [preview]);

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
    if (!preview || !preview.length) {
      setStatus({
        state: "error",
        message: "Upload a workbook and generate the preview before downloading.",
      });
      return;
    }

    if (!previewRef.current) {
      setStatus({
        state: "error",
        message: "Preview content not available. Please refresh and try again.",
      });
      return;
    }

    try {
      setIsGeneratingPdf(true);

      const pdfBlob = await generatePdfBlob();
      if (!pdfBlob) {
        setStatus({
          state: "error",
          message: "Failed to generate PDF blob.",
        });
        return;
      }

      // Create download link
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = pdfFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setStatus({
        state: "success",
        message: "PDF generated successfully.",
      });
    } catch (error) {
      console.error("PDF generation failed", error);
      setStatus({
        state: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to generate the PDF. Please try again.",
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [preview, pdfFilename, generatePdfBlob]);

  const handleUploadToS3 = useCallback(async () => {
    if (!preview || !preview.length) {
      setStatus({
        state: "error",
        message: "Upload a workbook and generate the preview before uploading to S3.",
      });
      return;
    }

    if (!previewRef.current) {
      setStatus({
        state: "error",
        message: "Preview content not available. Please refresh and try again.",
      });
      return;
    }

    try {
      setIsUploadingToS3(true);
      setS3Url(null);

      const pdfBlob = await generatePdfBlob();
      if (!pdfBlob) {
        setStatus({
          state: "error",
          message: "Failed to generate PDF blob.",
        });
        return;
      }

      // Upload to S3
      const formData = new FormData();
      formData.append("file", pdfBlob, pdfFilename);
      formData.append("fileName", pdfFilename);

      const response = await fetch("/api/upload-s3", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: "Failed to upload to S3",
          details: "Unable to parse error response",
        }));
        
        // Build detailed error message
        let errorMessage = errorData.error || "Failed to upload to S3";
        if (errorData.details) {
          errorMessage += `: ${errorData.details}`;
        }
        
        console.error("S3 upload API error:", {
          status: response.status,
          error: errorData.error,
          details: errorData.details,
          errorCode: errorData.errorCode,
        });
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setS3Url(data.url);

      setStatus({
        state: "success",
        message: "PDF uploaded to S3 successfully.",
      });
    } catch (error) {
      console.error("S3 upload failed", error);
      
      // Extract error message with details
      let errorMessage = "Failed to upload PDF to S3. Please try again.";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      setStatus({
        state: "error",
        message: errorMessage,
      });
    } finally {
      setIsUploadingToS3(false);
    }
  }, [preview, pdfFilename, generatePdfBlob]);
   
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
              <button
                type="button"
                onClick={handleUploadToS3}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!preview || !preview.length || isUploadingToS3 || isGeneratingPdf}
              >
                {isUploadingToS3 ? "Uploading to S3…" : "Upload to S3"}
              </button>
            </div>
          </div>
  
          {!preview || !preview.length ? (
            <div className="mt-6 rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
              Upload a workbook to enable preview actions.
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-6 text-sm text-emerald-700">
                Preview generated. Use the buttons above to open the full-page view or download the PDF.
              </div>
              {s3Url && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                  <p className="text-sm font-semibold text-indigo-900 mb-2">PDF uploaded to S3 successfully!</p>
                  <a
                    href={s3Url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-indigo-600 hover:text-indigo-800 underline break-all"
                  >
                    {s3Url}
                  </a>
                </div>
              )}
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
            <div className="sticky top-0 z-10 flex flex-col gap-4 border-b border-zinc-200 bg-white/95 px-6 py-4 backdrop-blur">
              <div className="flex items-center justify-between gap-4">
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
                    disabled={isGeneratingPdf}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isGeneratingPdf ? "Preparing PDF…" : "Download PDF"}
                  </button>
                  <button
                    type="button"
                    onClick={handleUploadToS3}
                    disabled={isUploadingToS3 || isGeneratingPdf}
                    className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-500 focus:outline-none focus:ring-4 focus:ring-green-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isUploadingToS3 ? "Uploading…" : "Upload to S3"}
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
              {s3Url && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                  <p className="text-xs font-semibold text-indigo-900 mb-1">PDF uploaded to S3:</p>
                  <a
                    href={s3Url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-600 hover:text-indigo-800 underline break-all"
                  >
                    {s3Url}
                  </a>
                </div>
              )}
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