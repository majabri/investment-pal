// Kids portfolios — seeded from the verified Fidelity import of 2026-07-21.
// Live values refresh via getPricesFn; shares/cost update on the next import.
export interface KidHolding { symbol: string; shares: number; price: number; avgCost: number; }
export interface KidAccount { key: string; name: string; accountNumber: string; cash: number; holdings: KidHolding[]; }

const base = (over: Partial<Record<string, [number, number, number]>>): KidHolding[] => {
  const std: Record<string, [number, number, number]> = {
    ABT: [1, 100.68, 134.30], MSFT: [1.255, 398.865, 400.35], AMZN: [0.368, 247.87, 272.96],
    GOOGL: [1, 349.10, 160.64], V: [0.278, 359.00, 358.49], FAMRX: [17.612, 33.81, 27.33],
    FFSFX: [35.56, 16.97, 13.62], BLK: [0.544, 1056.45, 1095.04], RY: [1.03, 211.085, 194.82],
    ARE: [5, 50.43, 49.22], GLD: [1, 373.73, 359.13], AVGO: [0.29, 387.02, 372.21],
    TSLA: [2, 381.27, 314.88], SLV: [7, 53.245, 46.80], CLSK: [5.507, 15.535, 18.18],
  };
  return Object.entries({ ...std, ...over }).map(([symbol, [shares, price, avgCost]]) => ({ symbol, shares, price, avgCost }));
};

export const KIDS_SEED: KidAccount[] = [
  { key: "jude", name: "Jude", accountNumber: "Z23958500", cash: 0.04, holdings: base({}) },
  { key: "karim", name: "Karim", accountNumber: "Z27754679", cash: 0.08,
    holdings: base({ ABT: [1, 100.68, 134.00], AMZN: [0.367, 247.935, 273.11], GOOGL: [1.001, 349.27, 160.51], BLK: [0.549, 1057.18, 1094.94], TSLA: [2, 381.15, 312.75], SLV: [7.004, 53.245, 46.80], CLSK: [5.51, 15.505, 18.17] }) },
  { key: "zain", name: "Zain", accountNumber: "Z32173271", cash: 0.31,
    holdings: base({ ABT: [1, 100.695, 133.99], AMZN: [0.367, 247.94, 272.89], BLK: [0.55, 1057.18, 1094.80], RY: [1.031, 211.09, 194.81], TSLA: [2, 381.10, 312.60], SLV: [7.004, 53.21, 46.80], CLSK: [5.491, 15.53, 18.21] }) },
];
