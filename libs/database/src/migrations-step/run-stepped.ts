import {
  planSteps,
  StepPlanError,
  STEP_INVARIANT_CAP,
  type Marker,
  type MigrationEdge,
  type RefFile,
  type Step,
} from './plan-steps.js';

export interface RunDeps {
  readMarker(): Promise<Marker | null>;
  writeRef(name: string, ref: RefFile): void;
  removeRef(name: string): void; // missing file is not an error
  runPrisma(args: string[]): Promise<number>; // exit code
  log(message: string): void;
  warn(message: string): void;
}

export async function runStepped(
  argv: string[],
  input: { edges: MigrationEdge[]; dbRef: RefFile; runId: string },
  deps: RunDeps,
): Promise<number> {
  if (argv.length > 0) {
    deps.warn(
      `db:migrate takes no arguments (got: ${argv.join(' ')}). Use db:migrate:show to inspect the plan.`,
    );
    return 2;
  }

  let steps: Step[];
  try {
    steps = planSteps(input.edges, input.dbRef, await deps.readMarker());
  } catch (error) {
    if (error instanceof StepPlanError) {
      deps.warn(error.message);
      return 1;
    }
    throw error;
  }

  const written: string[] = [];
  try {
    for (const [i, step] of steps.entries()) {
      const name =
        step.target === 'db' ? 'db' : `step-${input.runId}-${i + 1}`;
      if (step.target !== 'db') {
        deps.writeRef(name, step.target);
        written.push(name);
      }
      if (step.oversized) {
        deps.warn(
          `step ${i + 1} ends at ${step.node} and needs ${step.newInvariants.length} invariants (cap ${STEP_INVARIANT_CAP}); running it anyway`,
        );
      }
      deps.log(
        `step ${i + 1}/${steps.length}: --to ${name} (${step.newInvariants.length} invariants: ${step.newInvariants.join(', ')})`,
      );
      const code = await deps.runPrisma(['db', 'migrate', '--to', name]);
      if (code !== 0) return code;
    }
    return 0;
  } finally {
    for (const name of written) deps.removeRef(name);
  }
}
