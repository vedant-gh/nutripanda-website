interface PackageItem {
  quantity: number
}
export interface ParcelProfile {
  totalUnits: number
  weightGrams: number
  dimensionsCm: { length: number; breadth: number; height: number }
}

function boundedEnvNumber(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

/** The single canonical parcel estimate used by checkout and shipment creation. */
export function parcelProfileForItems(items: PackageItem[]): ParcelProfile {
  const totalUnits = items.reduce((sum, item) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error('Shipment items must have positive integer quantities')
    }
    return sum + item.quantity
  }, 0)
  if (totalUnits <= 0 || totalUnits > 100) {
    throw new Error('Shipment must contain between 1 and 100 units')
  }

  const perItemWeightGrams = boundedEnvNumber('PROSHIP_ITEM_WEIGHT_GRAMS', 150, 1, 10_000)
  return {
    totalUnits,
    weightGrams: perItemWeightGrams * totalUnits,
    dimensionsCm: {
      length: boundedEnvNumber('PROSHIP_PARCEL_LENGTH_CM', 15, 1, 200),
      breadth: boundedEnvNumber('PROSHIP_PARCEL_BREADTH_CM', 12, 1, 200),
      height: boundedEnvNumber('PROSHIP_PARCEL_HEIGHT_CM', 8, 1, 200),
    },
  }
}
