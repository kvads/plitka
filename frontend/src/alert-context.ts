import { createContext, type Context } from "react";
import type { AlertContainer } from "react-alert";

// react-alert 7 expects its context value to be populated by AlertProvider.
export const AlertContext = createContext(null) as unknown as Context<AlertContainer>;
