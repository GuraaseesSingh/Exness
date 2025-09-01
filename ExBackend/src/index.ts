//   # Main app entry (to run services)

import { start } from "./ws/mypricePoller";

start().catch(console.error);