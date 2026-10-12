import type { Layout } from "../../types";
export type ResultSet = {
  inputKey: string;
  variants: Layout[];
  selectedVariantId: number;
  acceptedPlacement: Layout;
  pendingPlacement: { x: number; y: number } | null;
  locked: boolean;
};
