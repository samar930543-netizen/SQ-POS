import {
  Bill,
  Product,
  AnalyticsTimeframe,
  ProductAnalytics,
  DemandSpike,
  TimeSeriesBucket,
  WeekdaySeasonality,
  CategorySeasonality,
  SalesAnalyticsReport,
  MovementTier,
  DailySalesDayBreakdown,
  DailySoldItemBreakdown,
  CustomAnalyticsDateRange,
  PredictiveInventoryItem,
  PredictiveInventoryReport,
  PredictiveStockUrgency,
} from '../types';
import { formatDateTime } from './formatters';
import { getConfiguredUnits, getPreferredUnit } from './unitSpecs';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86_400_000;

// Indian wholesale seasonal month multipliers by category (fallback baseline blended with live sales trend)
function getSeasonalMonthFactor(category: string, monthIndex: number): number {
  const cat = category.toLowerCase();
  // Oct (9), Nov (10), Dec (11): Festive / Winter (Tea, Biscuits, Oil, Snacks peak)
  if (monthIndex >= 9 && monthIndex <= 11) {
    if (cat.includes('beverage') || cat.includes('biscuit') || cat.includes('oil')) return 1.18;
    if (cat.includes('soap') || cat.includes('detergent')) return 1.05;
    return 1.1;
  }
  // Mar-Jun (2..5): Summer beverages & personal care lift
  if (monthIndex >= 2 && monthIndex <= 5) {
    if (cat.includes('beverage')) return 1.25;
    if (cat.includes('soap')) return 1.12;
    return 1.0;
  }
  // Jul-Sep (6..8): Monsoon tea & packaged snacks
  if (monthIndex >= 6 && monthIndex <= 8) {
    if (cat.includes('beverage') || cat.includes('biscuit')) return 1.12;
    return 0.98;
  }
  return 1.02;
}

export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatShortDayLabel(date: Date): string {
  const day = date.getDate();
  const mon = date.toLocaleString('en-IN', { month: 'short' });
  return `${day} ${mon}`;
}

function formatFullDayLabel(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function parseLocalDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(y, m - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== m - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

/**
 * Build comprehensive daily, weekly, monthly or custom-range sales analytics & velocity-based demand forecast
 */
export function buildSalesAnalyticsReport(
  bills: Bill[],
  products: Product[],
  timeframe: AnalyticsTimeframe,
  nowDate: Date = new Date(),
  customRange?: CustomAnalyticsDateRange,
  options?: { includePredictive?: boolean }
): SalesAnalyticsReport {
  const includePredictive = options?.includePredictive !== false;
  let windowDays = timeframe === 'daily' ? 1 : timeframe === 'weekly' ? 7 : 30;
  let endAnchor = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate()
  );

  if (timeframe === 'custom' && customRange?.startDate && customRange?.endDate) {
    const parsedStart = parseLocalDateKey(customRange.startDate);
    const parsedEnd = parseLocalDateKey(customRange.endDate);
    if (parsedStart && parsedEnd) {
      const [startDay, endDay] =
        parsedStart.getTime() <= parsedEnd.getTime()
          ? [parsedStart, parsedEnd]
          : [parsedEnd, parsedStart];
      endAnchor = endDay;
      const utcStart = Date.UTC(
        startDay.getFullYear(),
        startDay.getMonth(),
        startDay.getDate()
      );
      const utcEnd = Date.UTC(
        endDay.getFullYear(),
        endDay.getMonth(),
        endDay.getDate()
      );
      windowDays = Math.max(1, Math.round((utcEnd - utcStart) / DAY_MS) + 1);
    }
  }

  const endTs = new Date(
    endAnchor.getFullYear(),
    endAnchor.getMonth(),
    endAnchor.getDate(),
    23,
    59,
    59,
    999
  ).getTime();

  const startAnchor = new Date(
    endAnchor.getFullYear(),
    endAnchor.getMonth(),
    endAnchor.getDate() - (windowDays - 1),
    0,
    0,
    0,
    0
  );
  const currentStartTs = startAnchor.getTime();
  const prevStartTs = currentStartTs - windowDays * DAY_MS;
  const recent7StartTs = endTs - 7 * DAY_MS + 1;
  const startDateKey = toLocalDateKey(startAnchor);
  const endDateKey = toLocalDateKey(endAnchor);

  // Map products for O(1) lookup
  const productMap = new Map<string, Product>();
  products.forEach(p => productMap.set(p.id, p));

  // Track daily bucket maps & per-product daily series
  const dailyBucketMap = new Map<string, { revenue: number; piecesSold: number; billsCount: number }>();
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(
      endAnchor.getFullYear(),
      endAnchor.getMonth(),
      endAnchor.getDate() - i
    );
    dailyBucketMap.set(toLocalDateKey(d), { revenue: 0, piecesSold: 0, billsCount: 0 });
  }

  // Per-product stats accumulators
  interface ProdAcc {
    productId: string;
    productName: string;
    category: string;
    emoji: string;
    bundleUnitName: string;
    bundlePieces: number;
    currentStockPieces: number;
    lowStockThreshold: number;
    unitsSoldPieces: number;
    revenue: number;
    ordersCount: number;
    prevUnitsSoldPieces: number;
    prevRevenue: number;
    recent7Units: number;
    dailyUnitsMap: Map<string, number>;
  }

  const prodAccMap = new Map<string, ProdAcc>();
  products.forEach(p => {
    prodAccMap.set(p.id, {
      productId: p.id,
      productName: p.name,
      category: p.category,
      emoji: p.emoji,
      bundleUnitName: p.bundleUnitName,
      bundlePieces: p.bundlePieces,
      currentStockPieces: p.stockPieces,
      lowStockThreshold: p.lowStockThreshold,
      unitsSoldPieces: 0,
      revenue: 0,
      ordersCount: 0,
      prevUnitsSoldPieces: 0,
      prevRevenue: 0,
      recent7Units: 0,
      dailyUnitsMap: new Map(),
    });
  });

  // Weekday seasonality accumulator (over up to last 60 days for richer pattern detection)
  const weekdayMap = new Map<number, { revenue: number; pieces: number; dateKeys: Set<string> }>();
  for (let i = 0; i < 7; i++) {
    weekdayMap.set(i, { revenue: 0, pieces: 0, dateKeys: new Set() });
  }

  // Category accumulator
  const categoryCurrMap = new Map<string, { revenue: number; pieces: number }>();
  const categoryPrevMap = new Map<string, { revenue: number; pieces: number }>();

  let totalRevenue = 0;
  let prevRevenue = 0;
  let totalPiecesSold = 0;
  let prevPiecesSold = 0;
  let totalBills = 0;

  const seasonalityLookbackStart = endTs - 60 * DAY_MS + 1;

  bills.forEach(bill => {
    const bDate = new Date(bill.timestamp);
    const bTs = bDate.getTime();
    if (!Number.isFinite(bTs) || bTs > endTs) return;

    const dateKey = toLocalDateKey(bDate);
    const billPieces = bill.items.reduce((s, item) => s + (Number(item.totalPieces) || Number(item.quantity) || 0), 0);

    // Weekday seasonality over last 60d (only scanned when predictive analytics enabled)
    if (includePredictive && bTs >= seasonalityLookbackStart) {
      const wd = bDate.getDay();
      const wdEntry = weekdayMap.get(wd)!;
      wdEntry.revenue += bill.itemsTotal;
      wdEntry.pieces += billPieces;
      wdEntry.dateKeys.add(dateKey);
    }

    const inCurrent = bTs >= currentStartTs && bTs <= endTs;
    const inPrev = bTs >= prevStartTs && bTs < currentStartTs;

    if (inCurrent) {
      totalRevenue += bill.itemsTotal;
      totalPiecesSold += billPieces;
      totalBills += 1;

      const bucket = dailyBucketMap.get(dateKey);
      if (bucket) {
        bucket.revenue += bill.itemsTotal;
        bucket.piecesSold += billPieces;
        bucket.billsCount += 1;
      }
    } else if (inPrev) {
      prevRevenue += bill.itemsTotal;
      prevPiecesSold += billPieces;
    }

    if (!inCurrent && !inPrev && bTs < recent7StartTs) return;

    bill.items.forEach(item => {
      const qtyPieces = Number(item.totalPieces) || Number(item.quantity) || 0;
      const itemRev = Number(item.itemTotal) || 0;
      const catalogProd = productMap.get(item.productId);
      const category = catalogProd?.category || 'Custom / Other';

      let acc = prodAccMap.get(item.productId);
      if (!acc) {
        acc = {
          productId: item.productId,
          productName: item.productName,
          category,
          emoji: catalogProd?.emoji || '📦',
          bundleUnitName: item.bundleUnitName || 'Bundle',
          bundlePieces: item.bundlePieces || 1,
          currentStockPieces: catalogProd?.stockPieces ?? 0,
          lowStockThreshold: catalogProd?.lowStockThreshold ?? 10,
          unitsSoldPieces: 0,
          revenue: 0,
          ordersCount: 0,
          prevUnitsSoldPieces: 0,
          prevRevenue: 0,
          recent7Units: 0,
          dailyUnitsMap: new Map(),
        };
        prodAccMap.set(item.productId, acc);
      }

      if (inCurrent) {
        acc.unitsSoldPieces += qtyPieces;
        acc.revenue += itemRev;
        acc.ordersCount += 1;
        if (includePredictive) {
          acc.dailyUnitsMap.set(dateKey, (acc.dailyUnitsMap.get(dateKey) || 0) + qtyPieces);
        }

        const cCurr = categoryCurrMap.get(category) || { revenue: 0, pieces: 0 };
        cCurr.revenue += itemRev;
        cCurr.pieces += qtyPieces;
        categoryCurrMap.set(category, cCurr);
      } else if (inPrev) {
        acc.prevUnitsSoldPieces += qtyPieces;
        acc.prevRevenue += itemRev;

        const cPrev = categoryPrevMap.get(category) || { revenue: 0, pieces: 0 };
        cPrev.revenue += itemRev;
        cPrev.pieces += qtyPieces;
        categoryPrevMap.set(category, cPrev);
      }

      if (bTs >= recent7StartTs && bTs <= endTs) {
        acc.recent7Units += qtyPieces;
      }
    });
  });

  // Compute weekday seasonality index (when predictive analytics is enabled)
  const weekdayRaw: WeekdaySeasonality[] = [];
  for (let i = 0; i < 7; i++) {
    const entry = weekdayMap.get(i)!;
    const daysObserved = Math.max(1, entry.dateKeys.size);
    weekdayRaw.push({
      dayIndex: i,
      dayName: DAY_NAMES[i],
      avgRevenue: includePredictive ? Math.round(entry.revenue / daysObserved) : 0,
      avgPieces: includePredictive ? Math.round(entry.pieces / daysObserved) : 0,
      indexScore: 1,
    });
  }
  const avgWeekdayRev =
    weekdayRaw.reduce((s, d) => s + d.avgRevenue, 0) / 7 || 1;
  const weekdaySeasonality = includePredictive
    ? weekdayRaw.map(d => ({
        ...d,
        indexScore: Math.round((d.avgRevenue / avgWeekdayRev) * 100) / 100,
      }))
    : weekdayRaw;

  const peakWeekday =
    includePredictive && weekdaySeasonality.some(w => w.avgRevenue > 0)
      ? [...weekdaySeasonality].sort((a, b) => b.avgRevenue - a.avgRevenue)[0]
      : null;

  // Category trends & seasonal multipliers
  const currentMonth = endAnchor.getMonth();
  const categoryTrends: CategorySeasonality[] = Array.from(categoryCurrMap.entries())
    .map(([category, curr]) => {
      const prev = categoryPrevMap.get(category) || { revenue: 0, pieces: 0 };
      const growthPct =
        prev.revenue > 0
          ? Math.round(((curr.revenue - prev.revenue) / prev.revenue) * 100)
          : curr.revenue > 0
          ? 100
          : 0;
      const baseSeasonal = getSeasonalMonthFactor(category, currentMonth);
      // Blend calendar seasonal index with live momentum
      const momentumAdjust = Math.max(0.85, Math.min(1.25, 1 + growthPct / 400));
      const seasonalFactor = Math.round(baseSeasonal * momentumAdjust * 100) / 100;
      return {
        category,
        revenue: Math.round(curr.revenue),
        piecesSold: curr.pieces,
        sharePct: totalRevenue > 0 ? Math.round((curr.revenue / totalRevenue) * 100) : 0,
        growthPct,
        seasonalFactor,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const catFactorMap = new Map<string, number>();
  categoryTrends.forEach(c => catFactorMap.set(c.category, c.seasonalFactor));

  // Build product analytics & detect velocity-based demand spikes
  const demandSpikes: DemandSpike[] = [];
  const rawProdList = Array.from(prodAccMap.values());

  // Determine fast-moving threshold using non-zero velocity distribution
  const nonZeroVelocities = rawProdList
    .filter(p => p.unitsSoldPieces > 0)
    .map(p => p.unitsSoldPieces / windowDays)
    .sort((a, b) => b - a);
  const fastThreshold =
    nonZeroVelocities.length >= 4
      ? nonZeroVelocities[Math.max(0, Math.floor(nonZeroVelocities.length * 0.35) - 1)]
      : nonZeroVelocities[0] ?? 1;

  const allProducts: ProductAnalytics[] = rawProdList.map(acc => {
    const windowVelocity = acc.unitsSoldPieces / windowDays;
    const recent7Velocity = acc.recent7Units / 7;
    const prevVelocity = acc.prevUnitsSoldPieces / windowDays;

    // Weighted EMA velocity gives more weight to the latest 7 days
    const weightedVelocity =
      timeframe === 'daily'
        ? windowVelocity * 0.65 + recent7Velocity * 0.35
        : timeframe === 'monthly'
        ? recent7Velocity * 0.6 + windowVelocity * 0.4
        : timeframe === 'custom'
        ? windowDays > 7
          ? recent7Velocity * 0.45 + windowVelocity * 0.55
          : windowVelocity * 0.7 + prevVelocity * 0.3
        : windowVelocity * 0.7 + prevVelocity * 0.3;

    const baselineRate = prevVelocity > 0 ? prevVelocity : windowVelocity;
    const velocityChangePct =
      prevVelocity > 0
        ? Math.round(((windowVelocity - prevVelocity) / prevVelocity) * 100)
        : acc.unitsSoldPieces > 0
        ? 100
        : 0;

    // Spike detection & predictive demand (skipped when paused in Performance Manager)
    let effectiveSpikeMultiplier = 1;
    let isSpikeActive = false;
    let predicted7dDemand = 0;
    let predicted30dDemand = 0;
    let recommendedReorderPieces = 0;

    const seasonalFactor = includePredictive
      ? catFactorMap.get(acc.category) || getSeasonalMonthFactor(acc.category, currentMonth)
      : 1;
    const effectiveDailyVelocity = Math.max(0, Math.round(weightedVelocity * 100) / 100);

    if (includePredictive) {
      const dailyValues: Array<{ dateKey: string; qty: number }> = [];
      for (const key of dailyBucketMap.keys()) {
        dailyValues.push({ dateKey: key, qty: acc.dailyUnitsMap.get(key) || 0 });
      }
      const meanDaily =
        dailyValues.reduce((s, d) => s + d.qty, 0) / Math.max(1, dailyValues.length);
      const variance =
        dailyValues.reduce((s, d) => s + Math.pow(d.qty - meanDaily, 2), 0) /
        Math.max(1, dailyValues.length);
      const stdDev = Math.sqrt(variance);

      const peakEntry = dailyValues.reduce(
        (best, cur) => (cur.qty > best.qty ? cur : best),
        { dateKey: '', qty: 0 }
      );

      const recentVsBaselineMult =
        prevVelocity > 0
          ? recent7Velocity / prevVelocity
          : meanDaily > 0 && peakEntry.qty > 0
          ? peakEntry.qty / meanDaily
          : 1;
      const peakMultiplier =
        meanDaily > 0 ? peakEntry.qty / meanDaily : peakEntry.qty > 0 ? 2 : 1;

      effectiveSpikeMultiplier = Math.max(recentVsBaselineMult, peakMultiplier);
      const isZSpike =
        peakEntry.qty >= meanDaily + 1.45 * stdDev && peakEntry.qty >= 3;
      const isRatioSpike =
        (prevVelocity > 0 && recent7Velocity >= prevVelocity * 1.45 && acc.recent7Units >= 5) ||
        (meanDaily > 0 && peakEntry.qty >= meanDaily * 1.75 && peakEntry.qty >= 4);

      isSpikeActive = (isZSpike || isRatioSpike) && effectiveSpikeMultiplier >= 1.45;

      if (isSpikeActive) {
        const spikeVel = Math.max(recent7Velocity, peakEntry.qty);
        demandSpikes.push({
          productId: acc.productId,
          productName: acc.productName,
          category: acc.category,
          emoji: acc.emoji,
          baselineDailyVelocity: Math.round((baselineRate || meanDaily) * 10) / 10,
          spikeVelocity: Math.round(spikeVel * 10) / 10,
          multiplier: Math.round(effectiveSpikeMultiplier * 10) / 10,
          peakDate: peakEntry.dateKey,
          peakUnitsSold: peakEntry.qty,
          currentStockPieces: acc.currentStockPieces,
          daysOfCoverAtSpike:
            spikeVel > 0 ? Math.round((acc.currentStockPieces / spikeVel) * 10) / 10 : 999,
          severity: effectiveSpikeMultiplier >= 2.2 ? 'high' : 'moderate',
        });
      }

      predicted7dDemand = Math.ceil(effectiveDailyVelocity * 7 * seasonalFactor);
      predicted30dDemand = Math.ceil(effectiveDailyVelocity * 30 * seasonalFactor);

      // 14-day target stock + safety buffer (lowStockThreshold) minus current stock
      const target14dWithBuffer = Math.ceil(effectiveDailyVelocity * 14 * seasonalFactor) + acc.lowStockThreshold;
      recommendedReorderPieces =
        acc.currentStockPieces <= 0 || effectiveDailyVelocity > 0
          ? Math.max(0, target14dWithBuffer - acc.currentStockPieces)
          : 0;
    }

    const daysOfCover =
      acc.currentStockPieces <= 0
        ? 0
        : effectiveDailyVelocity > 0
        ? Math.round((acc.currentStockPieces / effectiveDailyVelocity) * 10) / 10
        : 999;

    let movementTier: MovementTier = 'steady';
    if (acc.currentStockPieces <= 0) {
      movementTier = 'out_of_stock';
    } else if (windowVelocity >= fastThreshold && acc.unitsSoldPieces > 0) {
      movementTier = 'fast_moving';
    } else if (acc.unitsSoldPieces === 0 || windowVelocity < fastThreshold * 0.35) {
      movementTier = 'slow_moving';
    }

    return {
      productId: acc.productId,
      productName: acc.productName,
      category: acc.category,
      emoji: acc.emoji,
      bundleUnitName: acc.bundleUnitName,
      bundlePieces: acc.bundlePieces,
      currentStockPieces: acc.currentStockPieces,
      lowStockThreshold: acc.lowStockThreshold,
      unitsSoldPieces: acc.unitsSoldPieces,
      revenue: Math.round(acc.revenue),
      ordersCount: acc.ordersCount,
      prevUnitsSoldPieces: acc.prevUnitsSoldPieces,
      dailyVelocity: effectiveDailyVelocity,
      prevDailyVelocity: Math.round(prevVelocity * 100) / 100,
      velocityChangePct,
      daysOfCover,
      predicted7dDemand,
      predicted30dDemand,
      recommendedReorderPieces,
      movementTier,
      isSpikeActive,
      spikeMultiplier: Math.round(effectiveSpikeMultiplier * 10) / 10,
    };
  });

  // Sort lists meaningfully
  const fastMoving = allProducts
    .filter(p => p.movementTier === 'fast_moving')
    .sort((a, b) => b.dailyVelocity - a.dailyVelocity);

  const steadyMoving = allProducts
    .filter(p => p.movementTier === 'steady')
    .sort((a, b) => b.dailyVelocity - a.dailyVelocity);

  const slowMoving = allProducts
    .filter(p => p.movementTier === 'slow_moving')
    .sort((a, b) => a.unitsSoldPieces - b.unitsSoldPieces || b.currentStockPieces - a.currentStockPieces);

  const outOfStock = allProducts
    .filter(p => p.movementTier === 'out_of_stock')
    .sort((a, b) => b.dailyVelocity - a.dailyVelocity);

  const criticalLowStock = allProducts
    .filter(
      p =>
        p.currentStockPieces > 0 &&
        (p.currentStockPieces <= p.lowStockThreshold || (p.dailyVelocity > 0 && p.daysOfCover <= 4))
    )
    .sort((a, b) => a.daysOfCover - b.daysOfCover);

  demandSpikes.sort((a, b) => b.multiplier - a.multiplier);

  // Build historical series (daily for <= 62d, weekly aggregation for longer custom ranges) + forecast series
  const rawDailySeries: TimeSeriesBucket[] = Array.from(dailyBucketMap.entries()).map(([key, val]) => {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return {
      key,
      label: formatShortDayLabel(dt),
      revenue: Math.round(val.revenue),
      piecesSold: val.piecesSold,
      billsCount: val.billsCount,
      isForecast: false,
    };
  });

  const dailySeries: TimeSeriesBucket[] =
    rawDailySeries.length > 62
      ? Array.from(
          { length: Math.ceil(rawDailySeries.length / 7) },
          (_, idx) => {
            const slice = rawDailySeries.slice(idx * 7, (idx + 1) * 7);
            const first = slice[0];
            const last = slice[slice.length - 1];
            return {
              key: `${first.key}_w`,
              label: slice.length > 1 ? `${first.label}–${last.label}` : first.label,
              revenue: slice.reduce((s, b) => s + b.revenue, 0),
              piecesSold: slice.reduce((s, b) => s + b.piecesSold, 0),
              billsCount: slice.reduce((s, b) => s + b.billsCount, 0),
              isForecast: false,
            };
          }
        )
      : rawDailySeries;

  // Compute average daily revenue & velocity for forecast projection
  const avgDailyRevenue = totalRevenue / windowDays;
  const avgDailyPieces = totalPiecesSold / windowDays;
  const momentumFactor =
    prevRevenue > 0
      ? Math.max(0.8, Math.min(1.35, 1 + (totalRevenue - prevRevenue) / (prevRevenue * 2)))
      : 1;

  const forecastDays = timeframe === 'weekly' ? 7 : timeframe === 'monthly' ? 14 : Math.min(14, Math.max(7, windowDays));
  const forecastSeries: TimeSeriesBucket[] = [];
  let predictedNextPeriodRevenue = 0;
  let predictedNextPeriodPieces = 0;

  if (includePredictive) {
    for (let i = 1; i <= windowDays; i++) {
      const futureDate = new Date(endTs + i * DAY_MS);
      const wdIndex = weekdaySeasonality[futureDate.getDay()]?.indexScore || 1;
      const projectedRev = Math.round(avgDailyRevenue * momentumFactor * (wdIndex > 0 ? wdIndex : 1));
      const projectedPcs = Math.max(0, Math.round(avgDailyPieces * momentumFactor * (wdIndex > 0 ? wdIndex : 1)));
      predictedNextPeriodRevenue += projectedRev;
      predictedNextPeriodPieces += projectedPcs;

      if (i <= forecastDays) {
        forecastSeries.push({
          key: toLocalDateKey(futureDate),
          label: formatShortDayLabel(futureDate),
          revenue: projectedRev,
          piecesSold: projectedPcs,
          billsCount: 0,
          isForecast: true,
        });
      }
    }
  }

  const revenueChangePct =
    prevRevenue > 0
      ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)
      : totalRevenue > 0
      ? 100
      : 0;

  const piecesChangePct =
    prevPiecesSold > 0
      ? Math.round(((totalPiecesSold - prevPiecesSold) / prevPiecesSold) * 100)
      : totalPiecesSold > 0
      ? 100
      : 0;

  const topCat = categoryTrends[0];
  const seasonalSummary = !includePredictive
    ? 'Predictive analytics & seasonal modeling are paused in Performance Manager.'
    : peakWeekday
    ? `${peakWeekday.dayName} is your highest-volume day (${Math.round(
        (peakWeekday.indexScore - 1) * 100
      ) >= 0 ? '+' : ''}${Math.round((peakWeekday.indexScore - 1) * 100)}% vs weekly avg)${
        topCat
          ? ` · ${topCat.category} leads revenue (${topCat.sharePct}% share, seasonal factor ${topCat.seasonalFactor}x)`
          : ''
      }`
    : 'Record sales across multiple days to unlock day-of-week & seasonal demand multipliers.';

  return {
    timeframe,
    windowDays,
    startDateKey,
    endDateKey,
    totalRevenue: Math.round(totalRevenue),
    prevRevenue: Math.round(prevRevenue),
    revenueChangePct,
    totalPiecesSold,
    prevPiecesSold,
    piecesChangePct,
    totalBills,
    avgOrderValue: totalBills > 0 ? Math.round(totalRevenue / totalBills) : 0,
    predictedNextPeriodRevenue: Math.round(predictedNextPeriodRevenue),
    predictedNextPeriodPieces,
    fastMoving,
    steadyMoving,
    slowMoving,
    outOfStock,
    criticalLowStock,
    allProducts: [...allProducts].sort((a, b) => b.revenue - a.revenue),
    demandSpikes,
    series: dailySeries,
    forecastSeries,
    weekdaySeasonality,
    categoryTrends,
    peakWeekday,
    seasonalSummary,
  };
}

/**
 * Build day-by-day breakdown of every item sold on each day, sorted by quantity sold descending
 * so highest-selling products stand out immediately.
 */
export function buildDailySalesBreakdown(
  bills: Bill[],
  products: Product[],
  limitDays = 45
): DailySalesDayBreakdown[] {
  const productMap = new Map<string, Product>();
  products.forEach(p => productMap.set(p.id, p));

  interface ItemDayAcc {
    productId: string;
    productName: string;
    category: string;
    emoji: string;
    bundleUnitName: string;
    bundlePieces: number;
    bundlesSold: number;
    loosePiecesSold: number;
    totalPiecesSold: number;
    revenue: number;
    billIds: Set<string>;
    unitPriceSum: number;
    lineCount: number;
    currentStockPieces: number;
    lowStockThreshold: number;
  }

  interface DayAcc {
    dateKey: string;
    dateObj: Date;
    billIds: Set<string>;
    totalRevenue: number;
    totalPiecesSold: number;
    itemsMap: Map<string, ItemDayAcc>;
  }

  const daysMap = new Map<string, DayAcc>();

  bills.forEach(bill => {
    const bDate = new Date(bill.timestamp);
    if (!Number.isFinite(bDate.getTime())) return;

    const dateKey = toLocalDateKey(bDate);
    let dayAcc = daysMap.get(dateKey);
    if (!dayAcc) {
      dayAcc = {
        dateKey,
        dateObj: new Date(bDate.getFullYear(), bDate.getMonth(), bDate.getDate()),
        billIds: new Set(),
        totalRevenue: 0,
        totalPiecesSold: 0,
        itemsMap: new Map(),
      };
      daysMap.set(dateKey, dayAcc);
    }

    dayAcc.billIds.add(bill.id);
    dayAcc.totalRevenue += Number(bill.itemsTotal) || 0;

    bill.items.forEach(item => {
      const qtyPieces = Number(item.totalPieces) || Number(item.quantity) || 0;
      const qty = Number(item.quantity) || 0;
      const itemRev = Number(item.itemTotal) || 0;
      dayAcc!.totalPiecesSold += qtyPieces;

      const prod = productMap.get(item.productId);
      let itemAcc = dayAcc!.itemsMap.get(item.productId);
      if (!itemAcc) {
        itemAcc = {
          productId: item.productId,
          productName: item.productName || prod?.name || 'Item',
          category: prod?.category || 'General',
          emoji: prod?.emoji || '📦',
          bundleUnitName: item.bundleUnitName || prod?.bundleUnitName || 'Bundle',
          bundlePieces: item.bundlePieces || prod?.bundlePieces || 1,
          bundlesSold: 0,
          loosePiecesSold: 0,
          totalPiecesSold: 0,
          revenue: 0,
          billIds: new Set(),
          unitPriceSum: 0,
          lineCount: 0,
          currentStockPieces: prod?.stockPieces ?? 0,
          lowStockThreshold: prod?.lowStockThreshold ?? 10,
        };
        dayAcc!.itemsMap.set(item.productId, itemAcc);
      }

      if (item.unit === 'bundle') {
        itemAcc.bundlesSold += qty;
      } else {
        itemAcc.loosePiecesSold += qty;
      }
      itemAcc.totalPiecesSold += qtyPieces;
      itemAcc.revenue += itemRev;
      itemAcc.billIds.add(bill.id);
      itemAcc.unitPriceSum += Number(item.unitPrice) || 0;
      itemAcc.lineCount += 1;
    });
  });

  const sortedDays = Array.from(daysMap.values())
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .slice(0, limitDays);

  return sortedDays.map(day => {
    const items: DailySoldItemBreakdown[] = Array.from(day.itemsMap.values())
      .map(item => ({
        productId: item.productId,
        productName: item.productName,
        category: item.category,
        emoji: item.emoji,
        bundleUnitName: item.bundleUnitName,
        bundlePieces: item.bundlePieces,
        bundlesSold: item.bundlesSold,
        loosePiecesSold: item.loosePiecesSold,
        totalPiecesSold: item.totalPiecesSold,
        revenue: Math.round(item.revenue),
        ordersCount: item.billIds.size,
        avgUnitPrice:
          item.totalPiecesSold > 0
            ? Math.round((item.revenue / item.totalPiecesSold) * 100) / 100
            : item.lineCount > 0
              ? Math.round((item.unitPriceSum / item.lineCount) * 100) / 100
              : 0,
        shareOfDayQuantityPct:
          day.totalPiecesSold > 0
            ? Math.round((item.totalPiecesSold / day.totalPiecesSold) * 1000) / 10
            : 0,
        currentStockPieces: item.currentStockPieces,
        lowStockThreshold: item.lowStockThreshold,
      }))
      .sort(
        (a, b) =>
          b.totalPiecesSold - a.totalPiecesSold ||
          b.revenue - a.revenue ||
          a.productName.localeCompare(b.productName)
      );

    const topItem = items[0];

    return {
      dateKey: day.dateKey,
      label: formatFullDayLabel(day.dateObj),
      weekdayName: DAY_NAMES[day.dateObj.getDay()],
      billsCount: day.billIds.size,
      totalRevenue: Math.round(day.totalRevenue),
      totalPiecesSold: day.totalPiecesSold,
      uniqueSkusSold: items.length,
      topSellerName: topItem?.productName,
      topSellerEmoji: topItem?.emoji,
      topSellerPieces: topItem?.totalPiecesSold || 0,
      items,
    };
  });
}

/**
 * Generates realistic 60-day historical wholesale bills for testing analytics & forecasting
 * when the store has sparse or no historical bill data yet.
 */
export function generateSampleSalesHistory(products: Product[]): Bill[] {
  if (products.length === 0) return [];
  const now = new Date();
  const sampleCustomers = [
    { id: 'cust_ramesh', name: 'Ramesh Kirana Store', phone: '9876543210' },
    { id: 'cust_gupta', name: 'Gupta General Store', phone: '9823456789' },
    { id: 'cust_ali', name: 'Ali Tea & Pan Stall', phone: '9712345678' },
    { id: 'cust_suresh', name: 'Suresh Kirana', phone: '9988776655' },
  ];

  // Pick fast movers, steady movers, and intentionally leave last 1-2 items slow
  const fastIds = new Set(['prod_goldflake', 'prod_parle_g', 'prod_dettol', 'prod_tata_tea']);
  const spikeIds = new Set(['prod_dettol', 'prod_fortune_oil']);

  const generated: Bill[] = [];
  let billCounter = 1001;

  for (let daysAgo = 59; daysAgo >= 0; daysAgo--) {
    const dt = new Date(now.getTime() - daysAgo * DAY_MS);
    dt.setHours(11 + (daysAgo % 7), (daysAgo * 13) % 55, 0, 0);
    const dayOfWeek = dt.getDay();

    // Weekend & Tuesday wholesale restock spikes
    const isPeakDay = dayOfWeek === 0 || dayOfWeek === 6 || dayOfWeek === 2;
    const billsToday = isPeakDay ? 3 : 2;

    for (let b = 0; b < billsToday; b++) {
      const cust = sampleCustomers[(daysAgo + b) % sampleCustomers.length];
      const billTime = new Date(dt.getTime() + b * 2 * 3_600_000);
      const items: Bill['items'] = [];

      products.forEach((prod, idx) => {
        // Keep last item very slow so slow-moving list has clear entries
        if (idx === products.length - 1 && daysAgo % 19 !== 0) return;
        if (idx === products.length - 2 && daysAgo % 11 !== 0) return;

        const isFast = fastIds.has(prod.id);
        const include = isFast ? (daysAgo + b + idx) % 2 === 0 : (daysAgo + b + idx) % 4 === 0;
        if (!include) return;

        // Recent 3-day demand spike on selected SKUs
        const isSpikeWindow = daysAgo <= 3 && spikeIds.has(prod.id);
        const configured = getConfiguredUnits(prod);
        const wantsBundle = isFast || isSpikeWindow || (daysAgo + idx) % 3 === 0;
        const unit = configured.includes(wantsBundle ? 'bundle' : 'piece')
          ? (wantsBundle ? 'bundle' : 'piece')
          : getPreferredUnit(prod);
        const useBundle = unit === 'bundle';
        const qty = isSpikeWindow ? 4 + (b % 2) : useBundle ? 1 + ((daysAgo + b) % 2) : 4 + ((daysAgo + idx) % 6);
        const unitPrice = useBundle ? prod.bundlePrice : prod.piecePrice;
        const totalPieces = useBundle ? qty * prod.bundlePieces : qty;
        const itemTotal = qty * unitPrice;

        items.push({
          productId: prod.id,
          productName: prod.name,
          unit,
          bundleUnitName: prod.bundleUnitName,
          bundlePieces: prod.bundlePieces,
          quantity: qty,
          unitPrice,
          totalPieces,
          itemTotal,
        });
      });

      if (items.length === 0) {
        const fallbackProd = products[0];
        const fallbackUnit = getPreferredUnit(fallbackProd);
        const fallbackPrice =
          fallbackUnit === 'bundle' ? fallbackProd.bundlePrice : fallbackProd.piecePrice;
        const fallbackPieces =
          fallbackUnit === 'bundle' ? fallbackProd.bundlePieces : 1;
        items.push({
          productId: fallbackProd.id,
          productName: fallbackProd.name,
          unit: fallbackUnit,
          bundleUnitName: fallbackProd.bundleUnitName,
          bundlePieces: fallbackProd.bundlePieces,
          quantity: 1,
          unitPrice: fallbackPrice,
          totalPieces: fallbackPieces,
          itemTotal: fallbackPrice,
        });
      }

      const itemsTotal = items.reduce((s, i) => s + i.itemTotal, 0);
      const paid = b % 3 === 0 ? Math.round(itemsTotal * 0.7) : itemsTotal;

      generated.push({
        id: `bill_hist_${daysAgo}_${b}_${Date.now()}`,
        billNumber: `SQ-${billCounter++}`,
        timestamp: billTime.toISOString(),
        formattedDateTime: formatDateTime(billTime),
        customerId: cust.id,
        customerName: cust.name,
        customerPhone: cust.phone,
        items,
        itemsTotal,
        isGstBill: false,
        previousBalance: 0,
        grandTotal: itemsTotal,
        amountReceived: paid,
        remainingBalance: Math.max(0, itemsTotal - paid),
        paymentMode: paid >= itemsTotal ? 'cash' : 'partial',
      });
    }
  }

  return generated.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * Predictive Inventory analyzer strictly over the past 30 rolling days of sales data.
 * Calculates average daily consumption (pieces/day) for every product and suggests
 * reorder quantities for low-stock or fast-depleting items.
 */
export function buildPredictiveInventoryReport(
  bills: Bill[],
  products: Product[],
  targetCoverDays: number = 14,
  nowDate: Date = new Date()
): PredictiveInventoryReport {
  const windowDays = 30 as const;
  const safeTargetDays = Math.max(1, Math.round(targetCoverDays));

  const endAnchor = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
    23,
    59,
    59,
    999
  );
  const startAnchor = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate() - (windowDays - 1),
    0,
    0,
    0,
    0
  );

  const startTs = startAnchor.getTime();
  const endTs = endAnchor.getTime();
  const startDateKey = toLocalDateKey(startAnchor);
  const endDateKey = toLocalDateKey(endAnchor);

  interface Acc {
    product: Product;
    sold30DaysPieces: number;
    sold30DaysRevenue: number;
    activeDates: Set<string>;
  }

  const accMap = new Map<string, Acc>();
  products.forEach(product => {
    accMap.set(product.id, {
      product,
      sold30DaysPieces: 0,
      sold30DaysRevenue: 0,
      activeDates: new Set(),
    });
  });

  let billsAnalyzedCount = 0;
  let total30DaysPiecesSold = 0;

  bills.forEach(bill => {
    const bDate = new Date(bill.timestamp);
    const bTs = bDate.getTime();
    if (!Number.isFinite(bTs) || bTs < startTs || bTs > endTs) return;

    billsAnalyzedCount += 1;
    const dateKey = toLocalDateKey(bDate);

    bill.items.forEach(item => {
      const qtyPieces = Number(item.totalPieces) || Number(item.quantity) || 0;
      const itemRev = Number(item.itemTotal) || 0;
      total30DaysPiecesSold += qtyPieces;

      const entry = accMap.get(item.productId);
      if (entry) {
        entry.sold30DaysPieces += qtyPieces;
        entry.sold30DaysRevenue += itemRev;
        if (qtyPieces > 0) {
          entry.activeDates.add(dateKey);
        }
      }
    });
  });

  const items: PredictiveInventoryItem[] = Array.from(accMap.values()).map(({ product, sold30DaysPieces, sold30DaysRevenue, activeDates }) => {
    const avgDailyConsumption = Math.round((sold30DaysPieces / windowDays) * 100) / 100;
    const currentStockPieces = product.stockPieces;
    const lowStockThreshold = Math.max(0, product.lowStockThreshold || 0);
    const bundlePieces = Math.max(1, product.bundlePieces || 1);

    const daysOfStockRemaining =
      currentStockPieces <= 0
        ? 0
        : avgDailyConsumption > 0
        ? Math.round((currentStockPieces / avgDailyConsumption) * 10) / 10
        : 999;

    // Item is flagged low-stock if at/below threshold OR projected to deplete within 7 days
    const isLowStock =
      currentStockPieces <= lowStockThreshold ||
      (avgDailyConsumption > 0 && daysOfStockRemaining <= 7);

    let urgency: PredictiveStockUrgency = 'healthy';
    if (currentStockPieces <= 0) {
      urgency = 'out_of_stock';
    } else if (
      currentStockPieces <= lowStockThreshold ||
      (avgDailyConsumption > 0 && daysOfStockRemaining <= 3)
    ) {
      urgency = 'critical';
    } else if (isLowStock) {
      urgency = 'low_stock';
    }

    let suggestedReorderPieces = 0;
    if (isLowStock) {
      if (avgDailyConsumption > 0) {
        const targetWithBuffer =
          Math.ceil(avgDailyConsumption * safeTargetDays) + lowStockThreshold;
        suggestedReorderPieces = Math.max(
          bundlePieces > 1 ? bundlePieces : 1,
          targetWithBuffer - currentStockPieces
        );
      } else {
        const fallbackTarget = Math.max(lowStockThreshold * 2, bundlePieces > 1 ? bundlePieces : 10);
        suggestedReorderPieces = Math.max(
          bundlePieces > 1 ? bundlePieces : 5,
          fallbackTarget - currentStockPieces
        );
      }
    }

    const suggestedReorderBundles =
      suggestedReorderPieces > 0 && bundlePieces > 1
        ? Math.ceil(suggestedReorderPieces / bundlePieces)
        : 0;

    const unitValuePiece =
      product.piecePrice > 0
        ? product.piecePrice
        : product.bundlePrice > 0 && bundlePieces > 0
        ? product.bundlePrice / bundlePieces
        : 0;
    const estimatedReorderCost = Math.round(suggestedReorderPieces * unitValuePiece);

    return {
      productId: product.id,
      productName: product.name,
      category: product.category,
      emoji: product.emoji,
      bundleUnitName: product.bundleUnitName || 'Bundle',
      bundlePieces,
      currentStockPieces,
      lowStockThreshold,
      sold30DaysPieces,
      sold30DaysRevenue: Math.round(sold30DaysRevenue),
      activeDaysSold: activeDates.size,
      avgDailyConsumption,
      daysOfStockRemaining,
      isLowStock,
      urgency,
      suggestedReorderPieces,
      suggestedReorderBundles,
      estimatedReorderCost,
    };
  });

  const urgencyRank: Record<PredictiveStockUrgency, number> = {
    out_of_stock: 0,
    critical: 1,
    low_stock: 2,
    healthy: 3,
  };

  const sortedAll = [...items].sort(
    (a, b) =>
      urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
      b.avgDailyConsumption - a.avgDailyConsumption ||
      a.currentStockPieces - b.currentStockPieces ||
      a.productName.localeCompare(b.productName)
  );

  const lowStockItems = sortedAll
    .filter(item => item.isLowStock)
    .sort(
      (a, b) =>
        urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
        a.daysOfStockRemaining - b.daysOfStockRemaining ||
        b.avgDailyConsumption - a.avgDailyConsumption
    );

  const totalSuggestedReorderPieces = lowStockItems.reduce(
    (sum, item) => sum + item.suggestedReorderPieces,
    0
  );
  const totalEstimatedReorderCost = lowStockItems.reduce(
    (sum, item) => sum + item.estimatedReorderCost,
    0
  );

  return {
    windowDays,
    targetCoverDays: safeTargetDays,
    startDateKey,
    endDateKey,
    billsAnalyzedCount,
    total30DaysPiecesSold,
    avgTotalDailyPieces: Math.round((total30DaysPiecesSold / windowDays) * 100) / 100,
    items: sortedAll,
    lowStockItems,
    totalSuggestedReorderPieces,
    totalEstimatedReorderCost,
  };
}

