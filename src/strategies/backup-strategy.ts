import Coordinator, {
  ActivationOptions,
  SyncStrategy,
  SyncStrategyOptions
} from '@orbit/coordinator';
import { QueryBuilder } from '@orbit/data';

export type BackupStrategyOptions = SyncStrategyOptions;

export class BackupStrategy extends SyncStrategy {
  async activate(
    coordinator: Coordinator,
    options: ActivationOptions = {}
  ): Promise<void> {
    await super.activate(coordinator, options);

    await this.restoreBackup();
  }

  async restoreBackup() {
    const source = this.source as any;
    const target = this.target as any;
    const transform = await target.pull((q: QueryBuilder) => q.findRecords());
    await source.sync(transform);
  }
}
