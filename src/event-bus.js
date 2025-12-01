import { EventEmitter } from "tseep/lib/ee-safe";
import { multiInstanceService } from "./shared/service";

export const EventBus = multiInstanceService(EventEmitter);
