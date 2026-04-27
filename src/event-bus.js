import { EventEmitter } from "tseep/lib/ee-safe";
import { EventHooks } from "./event-hooks";
import { multiInstanceService } from "./shared/service";

// add event subscription hooks
Object.assign(EventEmitter.prototype, EventHooks);

export const EventBus = multiInstanceService(EventEmitter);
