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

  const y = (L + 16) / 116;
  const x = a / 500 + y;
  const z = y - b / 200;

  const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);

  const Xn = 0.95047;
  const Yn = 1.0;
  const Zn = 1.08883;

  const X = Xn * f(x);
  const Y = Yn * f(y);
  const Z = Zn * f(z);

  let r = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
  let g = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
  let bl = X * 0.0557 + Y * -0.204 + Z * 1.057;

  const gamma = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

  r = clamp(gamma(r));
  g = clamp(gamma(g));
  bl = clamp(gamma(bl));

  const to255 = (c: number) => Math.round(clamp(c) * 255);

  if (alpha < 1) {
    return `rgba(${to255(r)}, ${to255(g)}, ${to255(bl)}, ${clamp(alpha)})`;
  }

  return `rgb(${to255(r)}, ${to255(g)}, ${to255(bl)})`;
}

function normalizeColor(value: string) {
  if (!value || typeof value !== "string") {
    return value;
  }
  return value.replace(/lab\([^)]*\)/gi, (match) => labToRgb(match));
}

function createPrintableClone(source: HTMLElement) {
  const clone = source.cloneNode(true) as HTMLElement;

  const applyComputedStyles = (originalNode: Element, clonedNode: Element) => {
    if (!(originalNode instanceof HTMLElement) || !(clonedNode instanceof HTMLElement)) {
      return;
    }

    const style = window.getComputedStyle(originalNode);
    clonedNode.style.color = normalizeColor(style.color);
    clonedNode.style.backgroundColor = normalizeColor(style.backgroundColor);
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
    clonedNode.style.textShadow = normalizeColor(style.textShadow);
    clonedNode.style.whiteSpace = style.whiteSpace;
    clonedNode.style.wordWrap = style.wordWrap;
    clonedNode.style.overflowWrap = style.overflowWrap;
    clonedNode.style.wordBreak = style.wordBreak;
    clonedNode.style.display = style.display;
    clonedNode.style.flexDirection = style.flexDirection;
    clonedNode.style.justifyContent = style.justifyContent;
    clonedNode.style.alignItems = style.alignItems;
    clonedNode.style.gap = style.gap;
    clonedNode.style.padding = style.padding;
    clonedNode.style.margin = style.margin;
    clonedNode.style.border = normalizeColor(style.border);
    clonedNode.style.borderColor = normalizeColor(style.borderColor);
    clonedNode.style.borderWidth = style.borderWidth;
    clonedNode.style.borderStyle = style.borderStyle;
    clonedNode.style.outline = normalizeColor(style.outline);
    clonedNode.style.borderRadius = style.borderRadius;
    clonedNode.style.boxShadow = normalizeColor(style.boxShadow);
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
  clone.classList.add("__pdf-clone");

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
      discountValue ?? discountAmountValue ?? null;

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
          <div className="flex flex-col gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">Quotation</h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Hi{" "}
                <MetaFieldInput
                  field="customer"
                  value={metaProp.customer}
                  placeholder="Customer Name"
                  onChange={onMetaChange}
                  className="inline-block w-auto border-b border-dotted border-zinc-400 pb-0.5"
                />
                {" "}&amp; Family,
                <br />
                Here is the quote that you requested. Please review and reach out to us for any
                questions.
              </p>
            </div>
            <div className="text-right text-sm text-zinc-600 dark:text-zinc-300">
              <MetaFieldInput
                field="quoteNumber"
                value={metaProp.quoteNumber}
                placeholder="QUOTE-####"
                onChange={onMetaChange}
                className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
              />
              <div>
                <span>Issued on </span>
                <MetaFieldInput
                  field="quoteDate"
                  value={metaProp.quoteDate}
                  placeholder="DD/MM/YYYY"
                  onChange={onMetaChange}
                  className="inline-block w-auto border-b border-dotted border-zinc-400 pb-0.5"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Project Details</h2>
            <div className="grid gap-4 rounded-3xl border border-zinc-200 bg-zinc-50 p-6 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 md:grid-cols-2 lg:grid-cols-4">
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
                    className={`flex flex-col gap-1 rounded-2xl border border-transparent bg-white p-4 dark:bg-zinc-950 ${
                      fullWidth ? "md:col-span-2 lg:col-span-4" : ""
                    }`}
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {config?.label ?? field}
                    </span>
                    <MetaFieldInput
                      field={field}
                      value={fieldValue}
                      placeholder={config?.label ?? "Enter value"}
                      onChange={onMetaChange}
                      className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
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
                        className="text-xs text-zinc-500 dark:text-zinc-400"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {hasSummaryTable && (
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Room Summary</h3>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm text-zinc-700 dark:text-zinc-200">
              <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
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
                  <tr key={row.room} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-3 font-semibold uppercase tracking-wide bg-red-600 text-white">
                      {row.room}
                    </td>
                    <td className="px-4 py-3 text-right">{formatMoney(row.modules)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(row.accessories)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(row.appliances)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(row.services)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(row.furniture)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-50">
                      {formatMoney(row.total)}
                    </td>
                  </tr>
                ))}
                {roomSummaryRows.length > 0 && (
                  <tr className="border-t border-zinc-200 bg-zinc-100 font-semibold uppercase tracking-wide text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-50">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.modules)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.accessories)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.appliances)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.services)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.furniture)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(totalsRow.total)}</td>
                  </tr>
                )}
                {effectiveDiscountValue != null && effectiveDiscountValue !== 0 && (
                  <tr className="border-t border-blue-200 bg-blue-50 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40">
                    <td className="px-4 py-3" colSpan={6}>
                      <div className="flex justify-end uppercase tracking-wide text-blue-600/80">Discount</div>
                    </td>
                    <td className="px-4 py-3 text-right text-blue-600/80">{formatMoney(Math.abs(effectiveDiscountValue))}</td>
                  </tr>
                )}
                {calculatedTotalAfterDiscount != null && (
                  <tr className="border-t border-zinc-200 bg-zinc-200 font-semibold uppercase tracking-wide text-zinc-900 dark:border-zinc-800 dark:bg-zinc-800/80 dark:text-zinc-50">
                    <td className="px-4 py-3">Total after discount</td>
                    <td className="px-4 py-3 text-right " colSpan={5}></td>
                    <td className="px-4 py-3 text-right">{formatMoney(calculatedTotalAfterDiscount)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">* All amounts include GST @ 18%</p>
        </section>
      )}

      {(effectiveDiscountValue != null || calculatedTotalAfterDiscount != null) && (
        <section className="grid gap-4 sm:grid-cols-2">
          {effectiveDiscountValue != null && (
            <div className="rounded-3xl border border-blue-200 bg-blue-50 p-6 text-rose-700 shadow-sm dark:border-blue-900/60 dark:bg-black-950/40 dark:text-black-200">
              <h4 className="text-xs text-blue-600/80 font-semibold uppercase tracking-[0.2em]">Discount Applied</h4>
              <p className="mt-3 text-blue-600/80 text-3xl font-bold">{formatMoney(Math.abs(effectiveDiscountValue))}</p>
              {totalBeforeDiscount != null && (
                <p className="mt-2 text-xs text-blue-600/80 dark:text-rose-300/80">
                  Subtracted from rooms total of {formatMoney(totalBeforeDiscount)}
                </p>
              )}
            </div>
          )}
          {calculatedTotalAfterDiscount != null && (
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-700 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
              <h4 className="text-xs font-semibold uppercase tracking-[0.2em]">Total Payable</h4>
              <p className="mt-3 text-3xl font-bold">{formatMoney(calculatedTotalAfterDiscount)}</p>
              {effectiveDiscountValue != null && (
                <p className="mt-2 text-xs text-emerald-600/90 dark:text-emerald-300/90">
                  After applying discount of {formatMoney(Math.abs(effectiveDiscountValue))}
                </p>
              )}
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
            <div className="border-b border-zinc-200 pb-2 dark:border-zinc-800">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
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
                    className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60"
                  >
                    <header className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                          {type.label}
                        </h4>
                        <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          {type.type}
                        </p>
                      </div>
                      <div className="text-sm text-zinc-600 dark:text-zinc-300">
                        {type.dimensionAggregate
                          ? `Total width: ${formatNumber.format(type.dimensionAggregate)} (units as per sheet)`
                          : ""}
                      </div>
                    </header>

                    {showInfoSections && (
                      <div className={`grid gap-4 ${gridColumns}`}>
                        {hasMaterials && (
                          <div className="space-y-2">
                            <h5 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                              Materials
                            </h5>
                            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                              {Object.entries(type.materials).map(([key, value]) => (
                                <p key={key}>
                                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
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
                            <h5 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                              Pricing Summary
                            </h5>
                            <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
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
                      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                        <table className="w-full min-w-[600px] text-left text-sm text-zinc-700 dark:text-zinc-200">
                          <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
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
                                className="border-t border-zinc-100 dark:border-zinc-800"
                              >
                                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">
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
          <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Project Policies &amp; Materials
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Specifications, materials, and policies governing design, installation, and service.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Core Materials</h3>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm text-zinc-700 dark:text-zinc-200">
              <tbody>
                {["Core Materials (Kitchen base unit, Bathroom Vanity Carcass, etc.)", "Dry Areas (Wardrobe & Lofts, TV units,etc)"]
                  .map((label, index) => {
                    const value = index === 0 ? "Century BWP (IS-710 Grade)" : "Century Sainik MR (ISI-303)";
                    return (
                      <tr key={label} className="border-t border-zinc-100 first:border-t-0 dark:border-zinc-800">
                        <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">{label}</td>
                        <td className="px-4 py-3">{value}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            ALL MODULES CAN BE CUSTOMIZED AS PER REQUIREMENT / ACTUAL SIZE
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Note: Plywood is not suggested for shutters, as they bend over time. HDHMR Pro is a better alternative
            &amp; recommended.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Material Thickness</h3>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm text-zinc-700 dark:text-zinc-200">
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
                  <tr key={row.label} className="border-t border-zinc-100 first:border-t-0 dark:border-zinc-800">
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">{row.label}</td>
                    <td className="px-4 py-3">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Core Material Brands</h3>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm text-zinc-700 dark:text-zinc-200">
              <tbody>
                {[
                  { label: "BWP (Boiling water proof)", value: "Century Club Prime" },
                  { label: "MR (Moisture Resistance)", value: "Century Sainik" },
                  { label: "HDHMR Pro", value: "Action Tesa" },
                  { label: "MDF", value: "Action Tesa / Green Panel" },
                  { label: "Edge Banding (Outside)", value: "Rehau (2mm Exterior)" },
                  { label: "Edge Banding (Inside)", value: "Rehau (0.8mm Exterior)" },
                ].map((row) => (
                  <tr key={row.label} className="border-t border-zinc-100 first:border-t-0 dark:border-zinc-800">
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">{row.label}</td>
                    <td className="px-4 py-3">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            We recommend checking physical samples of all finish options at our experience centers.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Finish Options</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
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
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Adhesive &amp; Accessories</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
            <p className="font-semibold text-zinc-900 dark:text-zinc-50">Adhesive</p>
            <p>Brand: Fevicol</p>
            <hr className="my-3 border-zinc-200 dark:border-zinc-800" />
            <p className="font-semibold text-zinc-900 dark:text-zinc-50">Accessories Included</p>
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
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Design Information</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
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
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Site Usage &amp; Terms</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 space-y-3">
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">Flat Usage</p>
              <p>Workers require electrical &amp; water connections and one bathroom during the project schedule.</p>
            </div>
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">Design Sign-off Terms</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Laminate colors may vary from renders; check samples before finalizing.</li>
                <li>Wood grain laminates: review full sheet if required before production.</li>
                <li>Closest matching Rehau edge banding used; customization not available.</li>
                <li>No design changes permitted after sign-off &amp; material procurement.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">Cleaning</p>
              <p>
                One-time professional cleaning (furniture, bathrooms, debris removal) provided at project end. Interim
                cleaning for occasions such as Pooja is chargeable.
              </p>
            </div>
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">Final Coat of Paint</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Recommended after interior completion to address installation marks.</li>
                <li>Cost excluded unless specified in quote.</li>
                <li>False ceiling painting included if opted.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Post Handover Service</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
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
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Warranty</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
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
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Payment Schedule</h3>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm text-zinc-700 dark:text-zinc-200">
              <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Milestone</th>
                  <th className="px-4 py-3">Percentage</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {paymentRows.map((row) => (
                  <tr key={row.stage} className="border-t border-zinc-100 first:border-t-0 dark:border-zinc-800">
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">{row.stage}</td>
                    <td className="px-4 py-3">{row.percentage}%</td>
                    <td className="px-4 py-3 text-right">
                      {row.amount != null ? formatCurrency.format(row.amount) : "-"}
                    </td>
                  </tr>
                ))}

                <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold dark:border-zinc-800 dark:bg-zinc-900/60">
                  <td className="px-4 py-3 text-zinc-900 dark:text-zinc-50">Total</td>
                  <td className="px-4 py-3">100%</td>
                  <td className="px-4 py-3 text-right">
                    {paymentTotal != null ? formatCurrency.format(paymentTotal) : "-"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Update the discount amount above to refresh the payable totals automatically.
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Works like electrical, plumbing, painting, countertops, tiling, false ceiling, etc., are considered under civil work.
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Non-modular products include appliances, fixtures, lighting, decor items, wallpapers, wooden flooring, blinds,
            curtains, readymade furniture, etc.
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            * NEFT/IMPS accepted. Card/NetBanking attracts 2% convenience fee (waived for first 10% tranche).
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Cancellation &amp; Scope Change</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
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
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Delivery &amp; Installation</h3>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 space-y-2">
            <p>Delivery and installation occur on/before the timeline communicated via email, at the provided address.</p>
            <p>Delivery date calculated post the following "All-Set-Go" conditions:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Both parties sign off final designs &amp; specifications.</li>
              <li>Site readiness checklist met; additional unloading charges may apply if no lift is available.</li>
              <li>All milestone payments received and acknowledged by HUB.</li>
              <li>Customer hands over site meeting all contractual conditions.</li>
              <li>Customer agrees not to solicit vendors outside HUB's approved scope without written consent.</li>
            </ul>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              * Disclaiming of Liability: HUB is not liable for products/services from non-approved vendors or where approved vendors act outside assigned scope. Any third-party arrangements are at the customer's risk and lie outside HUB's warranty.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Disclaimer of Liability</h3>
        <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
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
            // Ensure all fonts are loaded and styles are applied
            const clonedElement = clonedDoc.querySelector('.__pdf-clone') || clonedDoc.body;
            if (clonedElement instanceof HTMLElement) {
              const computedStyle = getComputedStyle(target);
              clonedElement.style.fontFamily = computedStyle.fontFamily;
              clonedElement.style.fontSize = computedStyle.fontSize;
              clonedElement.style.lineHeight = computedStyle.lineHeight;
              clonedElement.style.fontWeight = computedStyle.fontWeight;
              // Ensure all text elements have proper styles
              const allElements = clonedElement.querySelectorAll('*');
              allElements.forEach((el) => {
                if (el instanceof HTMLElement) {
                  const elStyle = getComputedStyle(el);
                  el.style.fontFamily = elStyle.fontFamily;
                  el.style.fontSize = elStyle.fontSize;
                  el.style.lineHeight = elStyle.lineHeight;
                  el.style.color = elStyle.color;
                  el.style.fontWeight = elStyle.fontWeight;
                }
              });
              // Force reflow to ensure styles are applied
              clonedElement.offsetHeight;
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
            // Ensure all fonts are loaded and styles are applied
            const clonedElement = clonedDoc.querySelector('.__pdf-clone') || clonedDoc.body;
            if (clonedElement instanceof HTMLElement) {
              const computedStyle = getComputedStyle(element);
              clonedElement.style.fontFamily = computedStyle.fontFamily;
              clonedElement.style.fontSize = computedStyle.fontSize;
              clonedElement.style.lineHeight = computedStyle.lineHeight;
              clonedElement.style.fontWeight = computedStyle.fontWeight;
              // Ensure all text elements have proper styles
              const allElements = clonedElement.querySelectorAll('*');
              allElements.forEach((el) => {
                if (el instanceof HTMLElement) {
                  const elStyle = getComputedStyle(el);
                  el.style.fontFamily = elStyle.fontFamily;
                  el.style.fontSize = elStyle.fontSize;
                  el.style.lineHeight = elStyle.lineHeight;
                  el.style.color = elStyle.color;
                  el.style.fontWeight = elStyle.fontWeight;
                }
              });
              // Force reflow to ensure styles are applied
              clonedElement.offsetHeight;
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
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-16 font-sans dark:bg-zinc-900">
      <main className="w-full max-w-5xl space-y-10 rounded-3xl bg-white p-10 shadow-xl dark:bg-zinc-950 dark:text-zinc-100">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold">Excel to PDF Designer Summary</h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            Upload an Excel workbook (.xlsx or .xls) and we parse every worksheet into a
            structured summary grouped by room and cabinet type. Preview the result below and
            download it as a formatted PDF.
          </p>
        </header>
 
        <section>
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-6 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 p-6 text-sm dark:border-zinc-700 dark:bg-zinc-900/60"
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
                className="mt-1 w-full cursor-pointer rounded-xl border border-zinc-300 bg-white p-3 text-sm text-zinc-700 transition hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
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
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {status.message}
          </p>
        )}
        {status.state === "success" && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            {status.message}
          </p>
        )}
 
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Preview</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Generate a preview to review the full designer summary and download it as a PDF.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setIsPreviewOpen(true)}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-4 focus:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                disabled={!preview || !preview.length}
              >
                Open Full Page Preview
              </button>
              <button
                type="button"
                onClick={handleDownloadPdf}
                className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-500"
                disabled={!preview || !preview.length || isGeneratingPdf}
              >
                {isGeneratingPdf ? "Preparing PDF…" : `Download PDF (${pdfFilename})`}
              </button>
            </div>
          </div>
 
          {!preview || !preview.length ? (
            <div className="mt-6 rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Upload a workbook to enable preview actions.
            </div>
          ) : (
            <div className="mt-6 rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-6 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
              Preview generated. Use the buttons above to open the full-page view or download the PDF.
            </div>
          )}
        </section>
 
        {metadata && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Customize Quotation Header</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
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
                    "mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm transition hover:border-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100",
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
                    className={`flex flex-col rounded-2xl border border-transparent bg-zinc-50 p-4 text-sm dark:bg-zinc-900/40 ${
                      fullWidth ? "md:col-span-2 lg:col-span-3" : ""
                    }`}
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
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
            className={`relative z-10 mt-6 mb-6 flex w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl transition-all duration-200 dark:bg-zinc-950 ${
              isPreviewOpen ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
            }`}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/95 px-6 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  Designer Summary Preview
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
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
                  className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-300 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-500"
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
