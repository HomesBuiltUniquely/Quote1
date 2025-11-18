"use client";

importhtml2canvasfrom"html2canvas";

import { jsPDF } from"jspdf";

import {

forwardRef,

useCallback,

useMemo,

useRef,

useState,

typeChangeEvent,

typeFormEvent,

} from"react";

typeStatus =

  | { state: "idle" }

  | { state: "uploading" }

  | { state: "error"; message: string }

  | { state: "success"; message: string };

typePreviewDetail = {

code: string;

description: string;

size: string;

price?: number;

};

typePreviewType = {

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

typePreviewRoom = {

name: string;

types: PreviewType[];

};

typeQuoteMetadata = {

reference?: string;

customer?: string;

designerName?: string;

designerEmail?: string;

designerPhone?: string;

quoteDate?: string;

quoteValidTill?: string;

priceVersion?: string;

propertyName?: string;

totalBuiltUpArea?: string;

propertyConfig?: string;

quoteStatus?: string;

address?: string;

quoteNumber?: string;

locationTagline?: string;

};

constMETADATA_FIELDS: Array<{

field: keyof QuoteMetadata;

label: string;

placeholder?: string;

multiline?: boolean;

fullWidth?: boolean;

}> = [

  { field:"locationTagline", label:"Location Tagline" },

  { field:"quoteNumber", label:"Quote Number" },

  { field:"quoteDate", label:"Quote Date" },

  { field:"customer", label:"Customer Name" },

  { field:"propertyName", label:"Property Name" },

  { field:"totalBuiltUpArea", label:"Total Built-up Area" },

  { field:"propertyConfig", label:"Property Config" },

  { field:"designerName", label:"Design Expert" },

  { field:"designerEmail", label:"Designer Email" },

  { field:"designerPhone", label:"Designer Phone" },

  { field:"priceVersion", label:"Price Version" },

  { field:"quoteValidTill", label:"Quote Valid Till" },

  { field:"quoteStatus", label:"Quote Status" },

  { field:"address", label:"Address", multiline:true, fullWidth:true },

];

typePreviewContentProps = {

meta: QuoteMetadata | null;

rooms: PreviewRoom[];

formatNumber: Intl.NumberFormat;

formatCurrency: Intl.NumberFormat;

};

constPreviewContent = forwardRef<HTMLDivElement, PreviewContentProps>(

  ({ meta, rooms, formatNumber, formatCurrency }, ref) => (

<divref={ref}className="space-y-10 p-8">

{meta && (

<sectionclassName="space-y-6">

<divclassName="flex flex-col gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800 md:flex-row md:items-start md:justify-between">

<divclassName="space-y-2">

{meta.locationTagline && (

<pclassName="text-xs font-medium uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">

{meta.locationTagline}

</p>

    )}

<h1className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">Quotation`</h1>`

<pclassName="text-sm text-zinc-600 dark:text-zinc-300">

    Hi {meta.customer?`${meta.customer} & Family`:"there"},

<br/>

    Here is the quote that you requested. Please review and reach out to us for any

    questions.

</p>

</div>

<divclassName="text-right text-sm text-zinc-600 dark:text-zinc-300">

{meta.quoteNumber && (

<pclassName="text-lg font-semibold text-zinc-900 dark:text-zinc-100">

{meta.quoteNumber}

</p>

    )}

{meta.quoteDate && `<p>`Issued on {meta.quoteDate}`</p>`}

</div>

</div>

<divclassName="space-y-4">

<h2className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Project Details`</h2>`

<divclassName="grid gap-4 rounded-3xl border border-zinc-200 bg-zinc-50 p-6 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 md:grid-cols-2 lg:grid-cols-4">

{[

    {

label:"Property Name",

value:meta.propertyName || meta.reference,

    },

    {

label:"Total Built-up Area",

value:meta.totalBuiltUpArea,

    },

    {

label:"Property Config",

value:meta.propertyConfig,

    },

    {

label:"Design Expert",

value:meta.designerName,

subtitle:meta.designerEmail || meta.designerPhone,

    },

    {

label:"Price Version",

value:meta.priceVersion,

    },

    {

label:"Quote Valid Till",

value:meta.quoteValidTill,

    },

    {

label:"Quote Status",

value:meta.quoteStatus,

    },

    {

label:"Address",

value:meta.address,

fullWidth:true,

    },

    ].map((field) => (

<div

key={field.label}

className={`flex flex-col gap-1 rounded-2xl border border-transparent bg-white p-4 dark:bg-zinc-950 ${

field.fullWidth?"md:col-span-2 lg:col-span-4":""

}`}

<spanclassName="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">

{field.label}

</span>

<spanclassName="text-base font-semibold text-zinc-900 dark:text-zinc-100">

{field.value?.trim() || "—"}

</span>

{field.subtitle && (

<spanclassName="text-xs text-zinc-500 dark:text-zinc-400">

{field.subtitle}

</span>

    )}

</div>

    ))}

</div>

</div>

</section>

    )}

{rooms.map((room) => {

constroomHasTypes = room.types.length>0;

if (!roomHasTypes) {

returnnull;

    }

return (

<sectionkey={room.name}className="space-y-6">

<divclassName="border-b border-zinc-200 pb-2 dark:border-zinc-800">

<h3className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">

{room.name}

</h3>

</div>

<divclassName="space-y-6">

{room.types.map((type) => {

consthasMaterials = Object.keys(type.materials).length>0;

consthasPricing = type.stats.total!=null;

constshowInfoSections = hasMaterials || hasPricing;

constgridColumns = hasMaterials && hasPricing?"md:grid-cols-2":"md:grid-cols-1";

return (

<div

key={`${room.name}-${type.type}`}

className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60"

<headerclassName="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">

<div>

<h4className="text-base font-semibold text-zinc-900 dark:text-zinc-50">

{type.label}

</h4>

<pclassName="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">

{type.type}

</p>

</div>

<divclassName="text-sm text-zinc-600 dark:text-zinc-300">

{type.dimensionAggregate

?`Total width: ${formatNumber.format(type.dimensionAggregate)} (units as per sheet)`

:""}

</div>

</header>

{showInfoSections && (

<divclassName={`grid gap-4 ${gridColumns}`}>

{hasMaterials && (

<divclassName="space-y-2">

<h5className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">

    Materials

</h5>

<divclassName="rounded-xl border border-zinc-200 bg-white p-3 text-sm leading-relaxed text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">

{Object.entries(type.materials).map(([key, value]) => (

<pkey={key}>

<spanclassName="font-medium text-zinc-900 dark:text-zinc-50">

{key}:

{" "}

{value}

</p>

    ))}

</div>

</div>

    )}

{hasPricing && (

<divclassName="space-y-2">

<h5className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">

    Pricing Summary

</h5>

<divclassName="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">

<p>

<spanclassName="font-medium">Total:{" "}

{type.stats.total!=null

?formatCurrency.format(type.stats.total)

:"-"}

</p>

</div>

</div>

    )}

</div>

    )}

{type.items.length>0 && (

<divclassName="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">

<tableclassName="w-full min-w-[600px] text-left text-sm text-zinc-700 dark:text-zinc-200">

<theadclassName="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">

<tr>

<thclassName="px-4 py-3">Code`</th>`

<thclassName="px-4 py-3">Unit Name`</th>`

<thclassName="px-4 py-3">Dimension`</th>`

<thclassName="px-4 py-3 text-right">Price`</th>`

</tr>

</thead>

<tbody>

{type.items.map((item, index) => (

<tr

key={`${type.type}-${item.code || "no-code"}-${index}`}

className="border-t border-zinc-100 dark:border-zinc-800"

<tdclassName="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">

{item.code || "-"}

</td>

<tdclassName="px-4 py-3">{item.description}`</td>`

<tdclassName="px-4 py-3">{item.size || "-"}`</td>`

<tdclassName="px-4 py-3 text-right">

{typeofitem.price==="number"

?formatCurrency.format(item.price)

:"-"}

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

</div>

  )

);

PreviewContent.displayName = "PreviewContent";

functiontoPdfFilename(original: string) {

constbase = original.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-_]+/gi, "_");

return `${base || "design_summary"}.pdf`;

}

exportdefaultfunctionHome() {

const [status, setStatus] = useState`<Status>`({ state:"idle" });

const [preview, setPreview] = useState<PreviewRoom[] | null>(null);

const [metadata, setMetadata] = useState<QuoteMetadata | null>(null);

const [pdfFilename, setPdfFilename] = useState("design_summary.pdf");

const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

const [isPreviewOpen, setIsPreviewOpen] = useState(false);

constpreviewRef = useRef`<HTMLDivElement>`(null);

constformatNumber = useMemo(

    () =>

newIntl.NumberFormat("en-IN", {

minimumFractionDigits:0,

maximumFractionDigits:2,

    }),

    []

  );

constformatCurrency = useMemo(

    () =>

newIntl.NumberFormat("en-IN", {

style:"currency",

currency:"INR",

minimumFractionDigits:0,

maximumFractionDigits:2,

    }),

    []

  );

consthandleSubmit = useCallback(

async (event: FormEvent`<HTMLFormElement>`) => {

event.preventDefault();

constform = event.currentTarget;

constformData = newFormData(form);

constfile = formData.get("file");

if (!(fileinstanceofFile) || !file.name) {

setStatus({

state:"error",

message:"Please choose an Excel file before converting.",

    });

return;

    }

try {

setStatus({ state:"uploading" });

setPreview(null);

setMetadata(null);

constresponse = awaitfetch("/api/convert", {

method:"POST",

body:formData,

    });

if (!response.ok) {

constdata = awaitresponse.json().catch(() =>null);

thrownewError(data?.error || "Conversion failed. Please try again.");

    }

constdata = awaitresponse.json();

if (!Array.isArray(data?.rooms)) {

thrownewError("Unexpected response format from server.");

    }

setPreview(data.roomsasPreviewRoom[]);

setMetadata((data.meta ?? {}) asQuoteMetadata);

setPdfFilename(toPdfFilename(file.name));

setIsPreviewOpen(true);

setStatus({

state:"success",

message:"Preview ready. Review the summary below and download the PDF when ready.",

    });

form.reset();

    } catch (error) {

console.error(error);

setStatus({

state:"error",

message:

errorinstanceofError

?error.message

:"Unexpected error. Please try again.",

    });

    }

    },

    []

  );

constclosePreview = useCallback(() =>setIsPreviewOpen(false), []);

consthandleMetaFieldChange = useCallback(

    (field: keyof QuoteMetadata, value: string) => {

setMetadata((previous) => {

constnext = { ...(previous ?? {}) } asQuoteMetadata;

if (!value.trim()) {

deletenext[field];

    } else {

next[field] = value;

    }

returnnext;

    });

    },

    []

  );

consthandleDownloadPdf = useCallback(async () => {

if (!previewRef.current || !preview || !preview.length) {

setStatus({

state:"error",

message:"Upload a workbook and generate the preview before downloading.",

    });

return;

    }

try {

if (!isPreviewOpen) {

setIsPreviewOpen(true);

awaitnewPromise((resolve) =>setTimeout(resolve, 100));

    }

setIsGeneratingPdf(true);

constelement = previewRef.current;

constcanvas = awaithtml2canvas(element, { scale:2, useCORS:true });

constimgData = canvas.toDataURL("image/png");

constpdf = newjsPDF("p", "mm", "a4");

constpageWidth = pdf.internal.pageSize.getWidth();

constpageHeight = pdf.internal.pageSize.getHeight();

constimgHeight = (canvas.height*pageWidth) /canvas.width;

letheightLeft = imgHeight;

letposition = 0;

pdf.addImage(imgData, "PNG", 0, position, pageWidth, imgHeight);

heightLeft-=pageHeight;

while (heightLeft>0) {

position = heightLeft-imgHeight;

pdf.addPage();

pdf.addImage(imgData, "PNG", 0, position, pageWidth, imgHeight);

heightLeft-=pageHeight;

    }

pdf.save(pdfFilename);

    } catch (error) {

console.error(error);

setStatus({

state:"error",

message:"Failed to generate the PDF. Please try again.",

    });

    } finally {

setIsGeneratingPdf(false);

    }

  }, [pdfFilename, preview, isPreviewOpen, setStatus]);

return (

<divclassName="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-16 font-sans dark:bg-zinc-900">

<mainclassName="w-full max-w-5xl space-y-10 rounded-3xl bg-white p-10 shadow-xl dark:bg-zinc-950 dark:text-zinc-100">

<headerclassName="space-y-2 text-center">

<h1className="text-3xl font-semibold">Excel to PDF Designer Summary`</h1>`

<pclassName="text-base text-zinc-600 dark:text-zinc-400">

    Upload an Excel workbook (.xlsx or .xls) and we parse every worksheet into a

    structured summary grouped by room and cabinet type. Preview the result below and

    download it as a formatted PDF.

</p>

</header>

<section>

<form

onSubmit={handleSubmit}

className="flex flex-col gap-6 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 p-6 text-sm dark:border-zinc-700 dark:bg-zinc-900/60"

<label

htmlFor="file"

className="flex flex-col gap-1 text-left text-base font-medium"

    Select Excel file

<input

id="file"

name="file"

type="file"

accept=".xls,.xlsx,.xlsm"

className="mt-1 w-full cursor-pointer rounded-xl border border-zinc-300 bg-white p-3 text-sm text-zinc-700 transition hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"

/>

<spanclassName="text-xs font-normal text-zinc-500 dark:text-zinc-400">

    Data stays in this session; we only derive the preview needed to build your PDF.

</span>

</label>

<button

type="submit"

className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"

disabled={status.state==="uploading"}

{status.state==="uploading"?"Processing…":"Generate Preview"}

</button>

</form>

</section>

{status.state==="error" && (

<pclassName="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">

{status.message}

</p>

    )}

{status.state==="success" && (

<pclassName="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">

{status.message}

</p>

    )}

<sectionclassName="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">

<divclassName="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

<div>

<h2className="text-xl font-semibold">Preview`</h2>`

<pclassName="text-sm text-zinc-600 dark:text-zinc-300">

    Generate a preview to review the full designer summary and download it as a PDF.

</p>

</div>

<divclassName="flex flex-col gap-3 sm:flex-row">

<button

type="button"

onClick={() =>setIsPreviewOpen(true)}

className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-4 focus:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"

disabled={!preview || !preview.length}

    Open Full Page Preview

</button>

<button

type="button"

onClick={handleDownloadPdf}

className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-500"

disabled={!preview || !preview.length || isGeneratingPdf}

{isGeneratingPdf?"Preparing PDF…":`Download PDF (${pdfFilename})`}

</button>

</div>

</div>

{!preview || !preview.length? (

<divclassName="mt-6 rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">

    Upload a workbook to enable preview actions.

</div>

    ) : (

<divclassName="mt-6 rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-6 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">

    Preview generated. Use the buttons above to open the full-page view or download the PDF.

</div>

    )}

</section>

{metadata && (

<sectionclassName="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">

<divclassName="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">

<div>

<h2className="text-xl font-semibold">Customize Quotation Header`</h2>`

<pclassName="text-sm text-zinc-600 dark:text-zinc-300">

    Update any of the fields below to fine-tune the preview content before exporting.

</p>

</div>

</div>

<divclassName="grid gap-4 md:grid-cols-2 lg:grid-cols-3">

{METADATA_FIELDS.map(({ field, label, multiline, fullWidth }) => {

constvalue = metadata?.[field] ?? "";

constcommonProps = {

id:field,

name:field,

value,

onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>

handleMetaFieldChange(field, event.target.value),

className:

"mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm transition hover:border-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100",

placeholder:label,

    };

return (

<label

key={field}

className={`flex flex-col rounded-2xl border border-transparent bg-zinc-50 p-4 text-sm dark:bg-zinc-900/40 ${

fullWidth?"md:col-span-2 lg:col-span-3":""

}`}

<spanclassName="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">

{label}

</span>

{multiline? (

<textarearows={3}{...commonProps}/>

    ) : (

<inputtype="text"{...commonProps}/>

    )}

</label>

    );

    })}

</div>

</section>

    )}

</main>

{preview && preview.length? (

<div

className={`fixed inset-0 z-50 flex items-stretch justify-center transition duration-200 ${

isPreviewOpen?"pointer-events-auto":"pointer-events-none"

}`}

<div

className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${

isPreviewOpen?"opacity-100":"opacity-0"

}`}

onClick={closePreview}

/>

<div

className={`relative z-10 mt-6 mb-6 flex w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl transition-all duration-200 dark:bg-zinc-950 ${

isPreviewOpen?"translate-y-0 opacity-100":"translate-y-6 opacity-0"

}`}

<divclassName="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/95 px-6 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">

<div>

<h2className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">

    Designer Summary Preview

</h2>

<pclassName="text-xs text-zinc-500 dark:text-zinc-400">

    Review the parsed workbook below. Use the buttons to download or close the preview.

</p>

</div>

<divclassName="flex items-center gap-3">

<button

type="button"

onClick={handleDownloadPdf}

className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"

disabled={isGeneratingPdf}

{isGeneratingPdf?"Preparing PDF…":"Download PDF"}

</button>

<button

type="button"

onClick={closePreview}

className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-300 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-500"

    Close

</button>

</div>

</div>

<divclassName="min-h-0 flex-1 overflow-auto">

<PreviewContent

ref={previewRef}

meta={metadata}

rooms={preview}

formatNumber={formatNumber}

formatCurrency={formatCurrency}

/>

</div>

</div>

</div>

    ) :null}

</div>

  );

}
