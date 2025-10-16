import { EventEmitter } from 'tseep';
import { multiInstanceService } from './shared/service';

export const EventBus = multiInstanceService(EventEmitter);
