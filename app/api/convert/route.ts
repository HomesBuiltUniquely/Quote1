import { NextResponse } from "next/server";
import { read, utils } from "xlsx";

export const runtime = "nodejs";

type MaterialsInfo = {
  label: string;
  fields: Record<string, string>;
};

type CabinetStats = {
  area?: number;
  costPerSqFt?: number;
  total?: number;
};

type DetailItem = {
  code: string;
  description: string;
  size: string;
  price?: number;
};

type RoomAggregation = {
  name: string;
  materials: Map<string, MaterialsInfo>;
  stats: Map<string, CabinetStats>;
  items: Map<string, DetailItem[]>;
  widthTotals: Map<string, number>;
};

type RoomResponse = {
  name: string;
  types: Array<{
    type: string;
    label: string;
    materials: Record<string, string>;
    stats: {
      areaSqFt: number | null;
      costPerSqFt: number | null;
      total: number | null;
    };
    dimensionAggregate: number | null;
    items: DetailItem[];
  }>;
};

type SummaryFinancialRow = {
  room: string;
  modules: number;
  accessories: number;
  appliances: number;
  services: number;
  furniture: number;
  total?: number;
};

type SummaryFinancials = {
  rows: SummaryFinancialRow[];
  subtotal?: number;
  totalPayable?: number;
  discount?: number;
};

function firstNumeric(...values: Array<number | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && !Number.isNaN(value)) {
      return value;
    }
  }
  return undefined;
}

type SummaryHeaderIndices = {
  room: number;
  modules?: number;
  accessories?: number;
  appliances?: number;
  services?: number;
  furniture?: number;
  total: number;
};

type QuoteMetadata = {
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
  totalProjectCost?: number;
};

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing Excel file upload" },
      { status: 400 }
    );
  }

  const buffer = await file.arrayBuffer();
  const workbook = read(buffer, { cellText: false, cellDates: true });

  if (!workbook.SheetNames.length) {
    return NextResponse.json(
      { error: "No sheets found in uploaded workbook" },
      { status: 400 }
    );
  }

  const { materialsByRoom, financials } = parseSummarySheet(workbook);
  const finalizedSummary = finalizeFinancials(financials);
  const rooms = aggregateRooms(workbook, materialsByRoom);

  if (!rooms.length) {
    return NextResponse.json(
      { error: "No recognizable cabinet data found in workbook" },
      { status: 400 }
    );
  }

  const meta = extractMetadata(workbook);
  const payload = formatRooms(rooms);
  const calculatedTotal = payload.reduce((roomSum, room) => {
    return (
      roomSum +
      room.types.reduce((typeSum, type) => typeSum + (type.stats.total ?? 0), 0)
    );
  }, 0);

  const preferredTotal =
    finalizedSummary?.totalPayable != null && !Number.isNaN(finalizedSummary.totalPayable)
      ? finalizedSummary.totalPayable
      : calculatedTotal;

  if (preferredTotal > 0 && meta.totalProjectCost == null) {
    meta.totalProjectCost = Number(preferredTotal.toFixed(2));
  }
 
  return NextResponse.json({ rooms: payload, meta, summary: finalizedSummary });
}

function parseSummarySheet(workbook: ReturnType<typeof read>) {
  const sheet = workbook.Sheets["Summary"];
  const materialsByRoom = new Map<string, Map<string, MaterialsInfo>>();
  const financials: SummaryFinancials = { rows: [] };

  if (!sheet) {
    return { materialsByRoom, financials: null };
  }

  const rows = utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  let currentRoom: string | null = null;
  let headerIndices: SummaryHeaderIndices | null = null;

  for (const row of rows) {
    const values = row.map((value) => (value ?? ""));
 
    const roomCandidate = values.find(
      (value): value is string => typeof value === "string" && isRoomName(value)
    );
    if (roomCandidate) {
      currentRoom = roomCandidate.trim();
      if (!materialsByRoom.has(currentRoom)) {
        materialsByRoom.set(currentRoom, new Map());
      }
    }

    if (currentRoom) {
      const materialCell = values.find(
        (value): value is string =>
          typeof value === "string" &&
          (value.includes("Carcass:") || value.includes("Handles:"))
      );

      if (materialCell) {
        const parsedMaterials = parseMaterialsBlock(materialCell);
        const roomMaterials = materialsByRoom.get(currentRoom)!;

        parsedMaterials.forEach((materials, key) => {
          if (!roomMaterials.has(key)) {
            roomMaterials.set(key, materials);
          }
        });
      }
    }

    if (!headerIndices) {
      if (
        values.some(
          (value) => typeof value === "string" && value.toUpperCase().includes("ROOM")
        ) &&
        values.some(
          (value) => typeof value === "string" && value.toUpperCase().includes("TOTAL")
        )
      ) {
        const roomIndex = values.findIndex(
          (value) => typeof value === "string" && value.toUpperCase().includes("ROOM")
        );
        if (roomIndex !== -1) {
          const indexMap: SummaryHeaderIndices = {
            room: roomIndex,
            total: values.findIndex(
              (value) => typeof value === "string" && value.toUpperCase().includes("TOTAL")
            ),
          };

          values.forEach((value, index) => {
            if (typeof value !== "string") {
              return;
            }
            const upper = value.toUpperCase();
            if (upper.includes("UNIT")) {
              indexMap.modules = index;
            } else if (upper.includes("ACCESS")) {
              indexMap.accessories = index;
            } else if (upper.includes("APPLIANCE")) {
              indexMap.appliances = index;
            } else if (upper.includes("SERVICE")) {
              indexMap.services = index;
            } else if (
              upper.includes("FURNITURE") ||
              upper.includes("DÉCOR") ||
              upper.includes("DECOR")
            ) {
              indexMap.furniture = index;
            } else if (upper.includes("HARDWARE") && !indexMap.accessories) {
              indexMap.accessories = index;
            }
          });

          if (indexMap.total !== -1) {
            headerIndices = indexMap;
          }
        }
      }
      continue;
    }

    const indices = headerIndices;
    const primaryLabel = values[indices.room];
    let labelCell = typeof primaryLabel === "string" ? primaryLabel.trim() : "";
    if (!labelCell) {
      const fallback = values.find((value, index) => {
        if (index === indices.total) {
          return false;
        }
        return typeof value === "string" && value.trim().length > 0;
      });
      if (typeof fallback === "string") {
        labelCell = fallback.trim();
      }
    }
    const totalValue = toNumber(values[indices.total] as string | number | undefined);
    const modulesValue =
      indices.modules != null
        ? toNumber(values[indices.modules] as string | number | undefined)
        : undefined;
    const accessoriesValue =
      indices.accessories != null
        ? toNumber(values[indices.accessories] as string | number | undefined)
        : undefined;
    const appliancesValue =
      indices.appliances != null
        ? toNumber(values[indices.appliances] as string | number | undefined)
        : undefined;
    const servicesValue =
      indices.services != null
        ? toNumber(values[indices.services] as string | number | undefined)
        : undefined;
    const furnitureValue =
      indices.furniture != null
        ? toNumber(values[indices.furniture] as string | number | undefined)
        : undefined;
 
    const rowNumericCandidates = values.map((value) =>
      toNumber(value as string | number | undefined)
    );

    const hasNumericalData = [
      modulesValue,
      accessoriesValue,
      appliancesValue,
      servicesValue,
      furnitureValue,
      totalValue,
      ...rowNumericCandidates,
    ].some((value) => typeof value === "number");
 
    if (!labelCell || !hasNumericalData) {
      continue;
    }
 
    const normalizedLabel = labelCell.trim().toLowerCase();
 
    if (normalizedLabel === "total") {
      const subtotalNumeric = firstNumeric(
        totalValue,
        modulesValue,
        accessoriesValue,
        appliancesValue,
        servicesValue,
        furnitureValue,
        ...rowNumericCandidates
      );
      if (typeof subtotalNumeric === "number" && financials.subtotal == null) {
        financials.subtotal = subtotalNumeric;
      }
      continue;
    }

    if (/^sub\s*total$/i.test(labelCell)) {
      const subtotalNumeric = firstNumeric(
        totalValue,
        modulesValue,
        accessoriesValue,
        appliancesValue,
        servicesValue,
        furnitureValue
      );
      if (typeof subtotalNumeric === "number") {
        financials.subtotal = subtotalNumeric;
      }
      continue;
    }

    if (/discount/i.test(labelCell)) {
      const discountNumeric = firstNumeric(
        totalValue,
        modulesValue,
        accessoriesValue,
        appliancesValue,
        servicesValue,
        furnitureValue,
        ...rowNumericCandidates
      );
      if (typeof discountNumeric === "number") {
        financials.discount = discountNumeric;
      }
      continue;
    }

    if (/total/i.test(labelCell) && /payable|after/i.test(labelCell)) {
      const payableNumeric = firstNumeric(
        totalValue,
        modulesValue,
        accessoriesValue,
        appliancesValue,
        servicesValue,
        furnitureValue
      );
      if (typeof payableNumeric === "number") {
        financials.totalPayable = payableNumeric;
      }
      continue;
    }

    const summaryRow: SummaryFinancialRow = {
      room: labelCell,
      modules: modulesValue ?? 0,
      accessories: accessoriesValue ?? 0,
      appliances: appliancesValue ?? 0,
      services: servicesValue ?? 0,
      furniture: furnitureValue ?? 0,
    };

    if (typeof totalValue === "number") {
      summaryRow.total = totalValue;
    } else {
      const derivedTotal =
        summaryRow.modules +
        summaryRow.accessories +
        summaryRow.appliances +
        summaryRow.services +
        summaryRow.furniture;
      if (derivedTotal > 0) {
        summaryRow.total = derivedTotal;
      }
    }

    financials.rows.push(summaryRow);
  }

  return {
    materialsByRoom,
    financials:
      financials.rows.length ||
      financials.discount != null ||
      financials.subtotal != null ||
      financials.totalPayable != null
        ? financials
        : { rows: [] },
  };
}

function finalizeFinancials(financials: SummaryFinancials | null) {
  if (!financials) {
    return null;
  }

  if (financials.subtotal != null) {
    if (financials.rows.length === 0) {
      financials.rows.push({
        room: "Total",
        modules: financials.subtotal,
        accessories: 0,
        appliances: 0,
        services: 0,
        furniture: 0,
        total: financials.subtotal,
      });
    }
  }

  if (
    financials.discount == null &&
    financials.subtotal != null &&
    financials.totalPayable != null
  ) {
    const derivedDiscount = financials.subtotal - financials.totalPayable;
    if (Math.abs(derivedDiscount) > 0.001) {
      financials.discount = derivedDiscount;
    }
  }

  return financials;
}

function aggregateRooms(
  workbook: ReturnType<typeof read>,
  materialsByRoom: Map<string, Map<string, MaterialsInfo>>
) {
  const roomMap = new Map<string, RoomAggregation>();

  workbook.SheetNames.forEach((sheetName) => {
    if (sheetName === "Summary" || sheetName === "Terms & Conditions") {
      return;
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return;
    }

    const rows = utils.sheet_to_json<(string | number)[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    });

    if (!rows.length) {
      return;
    }

    const roomName = detectRoomName(rows, sheetName);
    let room = roomMap.get(roomName);

    if (!room) {
      room = {
        name: roomName,
        materials: new Map(),
        stats: new Map(),
        items: new Map(),
        widthTotals: new Map(),
      };
      const summaryForRoom = materialsByRoom.get(roomName);
      if (summaryForRoom) {
        summaryForRoom.forEach((value, key) => room!.materials.set(key, value));
      }
      roomMap.set(roomName, room);
    }

    if (/sq\.?ft\.?$/i.test(sheetName)) {
      parseCabinetStats(rows, room);
    } else if (/details$/i.test(sheetName)) {
      parseDetailItems(rows, room);
    } else if (!room.materials.size) {
      // Use any materials mentioned directly in the sheet if summary is missing
      rows.forEach((row) => {
        row.forEach((cell) => {
          const text = typeof cell === "number" ? cell.toString() : String(cell || "");
          if (text.includes("Carcass:")) {
            const parsed = parseMaterialsBlock(text);
            parsed.forEach((value, key) => {
              if (!room!.materials.has(key)) {
                room!.materials.set(key, value);
              }
            });
          }
        });
      });
    }
  });

  return Array.from(roomMap.values());
}

function parseCabinetStats(rows: (string | number)[][], room: RoomAggregation) {
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => String(cell).toUpperCase().includes("CABINET TYPE"))
  );

  if (headerIndex === -1) {
    return;
  }

  const headerRow = rows[headerIndex].map((value) =>
    typeof value === "number" ? value.toString() : String(value || "")
  );

  const typeIndex = headerRow.findIndex((value) =>
    value.toUpperCase().includes("CABINET TYPE")
  );
  const areaIndex = headerRow.findIndex((value) => value.toUpperCase().includes("AREA"));
  const costIndex = headerRow.findIndex((value) => value.toUpperCase().includes("COST"));
  const totalIndex = headerRow.findIndex((value) => value.toUpperCase().includes("TOTAL"));

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i].map((value) =>
      typeof value === "number" ? value.toString() : String(value || "")
    );

    const typeName = row[typeIndex]?.trim();
    if (!typeName) {
      continue;
    }

    if (/^wood work/i.test(typeName) || /^total/i.test(typeName)) {
      break;
    }

    const normalized = normalizeTypeName(typeName);
    const stats: CabinetStats = {};

    if (areaIndex !== -1) {
      stats.area = toNumber(row[areaIndex]);
    }
    if (costIndex !== -1) {
      stats.costPerSqFt = toNumber(row[costIndex]);
    }
    if (totalIndex !== -1) {
      stats.total = toNumber(row[totalIndex]);
    }

    room.stats.set(normalized, {
      ...(room.stats.get(normalized) || {}),
      ...stats,
    });

    if (!room.materials.has(normalized)) {
      room.materials.set(normalized, {
        label: typeName,
        fields: {},
      });
    }
  }
}

function parseDetailItems(rows: (string | number)[][], room: RoomAggregation) {
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => String(cell).toUpperCase().includes("DESCRIPTION"))
  );

  if (headerIndex === -1) {
    return;
  }

  const headerRow = rows[headerIndex].map((value) =>
    typeof value === "number" ? value.toString() : String(value || "")
  );

  const slIndex = headerRow.findIndex((value) => value.toUpperCase().includes("SL"));
  const codeIndex = headerRow.findIndex((value) => value.toUpperCase().includes("CODE"));
  const descriptionIndex = headerRow.findIndex((value) =>
    value.toUpperCase().includes("DESCRIPTION")
  );
  const sizeIndex = headerRow.findIndex((value) => value.toUpperCase().includes("SIZE"));
  const priceIndex = headerRow.findIndex((value) => value.toUpperCase().includes("PRICE"));

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i].map((value) =>
      typeof value === "number" ? value.toString() : String(value || "")
    );

    const slValue = row[slIndex]?.trim();
    const code = row[codeIndex]?.trim();
    const description = row[descriptionIndex]?.trim();

    if (!slValue || !description) {
      continue;
    }

    // Skip subtotal rows
    if (/^total$/i.test(description)) {
      continue;
    }

    const type = classifyType(description);
    if (!type) {
      continue;
    }

    const size = sizeIndex !== -1 ? row[sizeIndex]?.trim() : "";
    const price = priceIndex !== -1 ? toNumber(row[priceIndex]) : undefined;

    if (!room.items.has(type)) {
      room.items.set(type, []);
    }

    room.items.get(type)!.push({
      code: code || "",
      description,
      size,
      price,
    });

    if (size) {
      const current = room.widthTotals.get(type) || 0;
      room.widthTotals.set(type, current + extractWidth(size));
    }

    if (!room.materials.has(type)) {
      room.materials.set(type, {
        label: type,
        fields: {},
      });
    }
  }
}

function parseMaterialsBlock(text: string) {
  const sections = text
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean);

  const map = new Map<string, MaterialsInfo>();

  sections.forEach((section) => {
    const lines = section
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      return;
    }

    const titleLine = lines[0].replace(/:$/, "").trim();
    if (!titleLine) {
      return;
    }

    const normalized = normalizeTypeName(titleLine);
    const fields: Record<string, string> = {};

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      const [rawKey, ...rest] = line.split(":");
      if (!rawKey || !rest.length) {
        continue;
      }
      const key = rawKey.trim();
      const value = rest.join(":").trim();
      if (key && value) {
        fields[key] = value;
      }
    }

    map.set(normalized, {
      label: titleLine,
      fields,
    });
  });

  return map;
}

function formatRooms(rooms: RoomAggregation[]): RoomResponse[] {
  return rooms.map((room) => {
    const typeKeys = new Set<string>();
    room.materials.forEach((_value, key) => typeKeys.add(key));
    room.stats.forEach((_value, key) => typeKeys.add(key));
    room.items.forEach((_value, key) => typeKeys.add(key));

    const types = Array.from(typeKeys)
      .sort((a, b) => a.localeCompare(b))
      .map((type) => {
        const materialInfo = room.materials.get(type);
        const stats = room.stats.get(type) || {};
        const items = room.items.get(type) || [];
        const dimensionAggregate = room.widthTotals.get(type) || null;

        return {
          type,
          label: materialInfo?.label ?? type,
          materials: materialInfo?.fields ?? {},
          stats: {
            areaSqFt: stats.area ?? null,
            costPerSqFt: stats.costPerSqFt ?? null,
            total: stats.total ?? null,
          },
          dimensionAggregate,
          items: items.map((item) => ({
            ...item,
            price: typeof item.price === "number" ? item.price : undefined,
          })),
        };
      });

    return {
      name: room.name,
      types,
    };
  });
}

function toNumber(value: string | number | undefined) {
  if (typeof value === "number") {
    return Number.isNaN(value) ? undefined : value;
  }
  if (!value) {
    return undefined;
  }
  const sanitized = value.replace(/[^0-9.+-]/g, "");
  const numeric = parseFloat(sanitized);
  return Number.isNaN(numeric) ? undefined : numeric;
}

function extractWidth(size: string) {
  const widthMatch = size.match(/([0-9]+(?:\.[0-9]+)?)\s*[wW]/);
  if (widthMatch) {
    return parseFloat(widthMatch[1]);
  }
  const firstNumber = size.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (firstNumber) {
    return parseFloat(firstNumber[1]);
  }
  return 0;
}

function detectRoomName(rows: (string | number)[][], fallback: string) {
  for (const row of rows) {
    for (const cell of row) {
      const text = typeof cell === "number" ? cell.toString() : String(cell || "");
      if (isRoomName(text)) {
        return text.trim();
      }
    }
  }
  return fallback;
}

function isRoomName(text: string) {
  if (!text) {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return / - /.test(trimmed);
}

function normalizeTypeName(input: string) {
  const name = input.trim();
  const lower = name.toLowerCase();

  if (lower.includes("base")) {
    return "Base Cabinets";
  }
  if (lower.includes("wall")) {
    return "Wall Cabinets";
  }
  if (lower.includes("tall")) {
    return "Tall Cabinets";
  }
  if (lower.includes("suspended")) {
    return "Suspended Cabinets";
  }
  if (lower.includes("mid tall")) {
    return "Tall Cabinets";
  }
  if (lower.includes("open shelf") || lower.includes("panel")) {
    return "Open Shelf & Panels";
  }
  if (lower.includes("skirt")) {
    return "Skirting";
  }
  if (lower.includes("loft")) {
    return "Lofts";
  }
  if (lower.includes("pooja")) {
    return "Pooja Units";
  }
  if (lower.includes("filler")) {
    return "Fillers";
  }
  if (lower.includes("hinged wardrobe")) {
    return "Hinged Wardrobes";
  }
  if (lower.includes("sliding wardrobe")) {
    return "Sliding Wardrobes";
  }
  if (lower.includes("wardrobe")) {
    return "Hinged Wardrobes";
  }

  return name;
}

function classifyType(description: string) {
  const normalized = normalizeTypeName(description);
  if (normalized !== description.trim()) {
    return normalized;
  }

  const lower = description.toLowerCase();
  if (lower.includes("base")) {
    return "Base Cabinets";
  }
  if (lower.includes("wall")) {
    return "Wall Cabinets";
  }
  if (lower.includes("tall")) {
    return "Tall Cabinets";
  }
  if (lower.includes("suspended")) {
    return "Suspended Cabinets";
  }
  if (lower.includes("pooja")) {
    return "Pooja Units";
  }
  if (lower.includes("shelf") || lower.includes("panel")) {
    return "Open Shelf & Panels";
  }
  if (lower.includes("skirt")) {
    return "Skirting";
  }
  if (lower.includes("loft")) {
    return "Lofts";
  }
  if (lower.includes("filler")) {
    return "Fillers";
  }
  if (lower.includes("wardrobe")) {
    return lower.includes("sliding")
      ? "Sliding Wardrobes"
      : "Hinged Wardrobes";
  }

  return undefined;
}

function formatNumber(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "";
  }
  return value.toString();
}

function extractMetadata(workbook: ReturnType<typeof read>): QuoteMetadata {
  const meta: QuoteMetadata = {};

  const processRows = (rows: (string | number)[][]) => {
    rows.forEach((row) => {
      const values = row.map((value) =>
        typeof value === "number" ? value.toString() : String(value || "")
      );

      const findValue = (pattern: RegExp) => {
        const index = values.findIndex((value) => pattern.test(value));
        if (index === -1) {
          return undefined;
        }
        for (let i = index + 1; i < values.length; i += 1) {
          const candidate = values[i]?.trim();
          if (candidate) {
            return candidate;
          }
        }
        return undefined;
      };

      const reference = findValue(/^reference$/i);
      if (reference && !meta.reference) {
        meta.reference = reference;
        if (!meta.propertyName) {
          meta.propertyName = reference;
        }
      }

      const propertyName = findValue(/property\s*name/i);
      if (propertyName && !meta.propertyName) {
        meta.propertyName = propertyName;
      }

      const customer = findValue(/^customer$/i);
      if (customer && !meta.customer) {
        meta.customer = customer;
      }

      const priceVersion = findValue(/price\s*version/i);
      if (priceVersion && !meta.priceVersion) {
        meta.priceVersion = priceVersion;
      }

      const quoteValidTill = findValue(/quote\s*valid\s*till/i);
      if (quoteValidTill && !meta.quoteValidTill) {
        meta.quoteValidTill = quoteValidTill;
      }

      const quoteStatus = findValue(/quote\s*status/i);
      if (quoteStatus && !meta.quoteStatus) {
        meta.quoteStatus = quoteStatus;
      }

      const propertyConfig = findValue(/property\s*config/i);
      if (propertyConfig && !meta.propertyConfig) {
        meta.propertyConfig = propertyConfig;
      }

      const totalBuiltUpArea = findValue(/total\s*built/i);
      if (totalBuiltUpArea && !meta.totalBuiltUpArea) {
        meta.totalBuiltUpArea = totalBuiltUpArea;
      }

      const designerName = findValue(/design\s*expert/i) || findValue(/dp\s*name/i);
      if (designerName && !meta.designerName) {
        meta.designerName = designerName;
      }

      const address = findValue(/address/i);
      if (address && !meta.address) {
        meta.address = address;
      }

      const quoteNumber = values.find((value) => /\bquote[-\s]?\w+/i.test(value));
      if (quoteNumber && !meta.quoteNumber) {
        meta.quoteNumber = quoteNumber.trim();
      }

      const email = values.find((value) => /@/.test(value) && /\./.test(value));
      if (email && !meta.designerEmail) {
        meta.designerEmail = email.trim();
      }

      const phone = values.find((value) => /\d{7,}/.test(value.replace(/\D/g, "")));
      if (phone && !meta.designerPhone) {
        meta.designerPhone = phone.trim();
      }

      const dateMatch = values.find((value) =>
        /(\d{2}[\/-]\d{2}[\/-]\d{2,4})|(\d{4}[\/-]\d{2}[\/-]\d{2})/.test(value)
      );
      if (dateMatch && !meta.quoteDate) {
        const match = dateMatch.match(
          /(\d{2}[\/-]\d{2}[\/-]\d{2,4})|(\d{4}[\/-]\d{2}[\/-]\d{2})/
        );
        if (match) {
          meta.quoteDate = match[0];
        }
      }
    });
  };

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return;
    }

    const rows = utils.sheet_to_json<(string | number)[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    });

    processRows(rows);
  });

  return meta;
}
