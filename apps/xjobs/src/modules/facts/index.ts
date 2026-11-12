export { FACTS_VERSION } from './config/facts.config';
export { FactsModule } from './facts.module';
export { FactsRepository } from './repositories/facts.repository';
export {
  FactsService,
  FACTS_CLOCK,
  type BuildResult,
} from './services/facts.service';
export type { JobFactsDocument } from './schema/facts';
