export {
  PROCESSOR_CHANNEL,
  PROCESSOR_CONFIG,
  type ProcessorConfig,
} from './config/processor.config';
export {
  PROCESSOR_CLOCK,
  ProcessorGuard,
} from './services/processor-guard.service';
export {
  createProcessorService,
  ProcessorBlockedError,
  ProcessorService,
  type ProcessOutcome,
} from './services/processor.service';
export { ProcessorModule } from './processor.module';
export {
  type Claim,
  ProcessorRepository,
  linkedInJobIds,
  type ReprocessFilter,
} from './repositories/processor.repository';
export { ExtractionModel } from './models/types';
export {
  CLAUDE_BIN,
  checkClaudeCall,
  checkClaudeInstalled,
  describeFailure,
  hasClaudeCredential,
  NO_CLAUDE_CREDENTIAL,
} from './models/claude/startup';
