import { CUSTOM_MODEL_CLASS } from '@ember-data/canary-features';

import { identifierCacheFor } from '../../identifiers/cache';
import { RecordDataStoreWrapper as IRecordDataStoreWrapper } from '../../ts-interfaces/record-data-store-wrapper';
import { BRAND_SYMBOL } from '../../utils/brand';
import constructResource from '../../utils/construct-resource';
import { internalModelFactoryFor } from './internal-model-factory';

type StableRecordIdentifier = import('../../ts-interfaces/identifier').StableRecordIdentifier;
type CoreStore = import('../core-store').default;
type IdentifierCache = import('../../identifiers/cache').IdentifierCache;
type RecordData = import('../../ts-interfaces/record-data').RecordData;
type AttributesSchema = import('../../ts-interfaces/record-data-schemas').AttributesSchema;
type RelationshipsSchema = import('../../ts-interfaces/record-data-schemas').RelationshipsSchema;
type RelationshipSchema = import('../../ts-interfaces/record-data-schemas').RelationshipSchema;
type RelationshipDefinition = import('@ember-data/model/-private/system/relationships/relationship-meta').RelationshipDefinition;
/**
  @module @ember-data/store
*/

type StableIdentifierOrString = StableRecordIdentifier | string;

function metaIsRelationshipDefinition(meta: RelationshipSchema): meta is RelationshipDefinition {
  return typeof (meta as RelationshipDefinition)._inverseKey === 'function';
}

export default class RecordDataStoreWrapper implements IRecordDataStoreWrapper {
  [BRAND_SYMBOL]: 'RecordDataStoreWrapper';
  _willUpdateManyArrays: boolean;
  private _pendingManyArrayUpdates: StableIdentifierOrString[];

  constructor(public _store: CoreStore) {
    this._willUpdateManyArrays = false;
    this._pendingManyArrayUpdates = [];
  }

  get identifierCache(): IdentifierCache {
    return identifierCacheFor(this._store);
  }

  /**
   * Exists so that DefaultRecordData can check for model types
   * in DEBUG for relationships. Should be refactored away.
   *
   * @internal
   */
  _hasModelFor(type: string) {
    return this._store._hasModelFor(type);
  }

  /**
   * @internal
   */
  _scheduleManyArrayUpdate(identifier: StableRecordIdentifier, key: string) {
    let pending = (this._pendingManyArrayUpdates = this._pendingManyArrayUpdates || []);
    pending.push(identifier, key);

    if (this._willUpdateManyArrays === true) {
      return;
    }

    this._willUpdateManyArrays = true;
    let backburner: any = this._store._backburner;

    backburner.join(() => {
      backburner.schedule('syncRelationships', this, this._flushPendingManyArrayUpdates);
    });
  }

  notifyErrorsChange(type: string, id: string, lid: string | null): void;
  notifyErrorsChange(type: string, id: string | null, lid: string): void;
  notifyErrorsChange(type: string, id: string | null, lid: string | null): void {
    const resource = constructResource(type, id, lid);
    const identifier = identifierCacheFor(this._store).getOrCreateRecordIdentifier(resource);

    let internalModel = internalModelFactoryFor(this._store).peek(identifier);

    if (internalModel) {
      internalModel.notifyErrorsChange();
    }
  }

  _flushPendingManyArrayUpdates(): void {
    if (this._willUpdateManyArrays === false) {
      return;
    }

    let pending = this._pendingManyArrayUpdates;
    this._pendingManyArrayUpdates = [];
    this._willUpdateManyArrays = false;
    const factory = internalModelFactoryFor(this._store);

    for (let i = 0; i < pending.length; i += 2) {
      let identifier = pending[i] as StableRecordIdentifier;
      let key = pending[i + 1] as string;
      let internalModel = factory.peek(identifier);

      if (internalModel) {
        internalModel.notifyHasManyChange(key);
      }
    }
  }

  attributesDefinitionFor(type: string): AttributesSchema {
    return this._store._attributesDefinitionFor(type);
  }

  relationshipsDefinitionFor(type: string): RelationshipsSchema {
    return this._store._relationshipsDefinitionFor(type);
  }

  inverseForRelationship(type: string, key: string): string | null {
    const modelClass = this._store.modelFor(type);
    const definition = this.relationshipsDefinitionFor(type)[key];
    if (!definition) {
      return null;
    }
    if (CUSTOM_MODEL_CLASS) {
      if (definition.inverse !== undefined) {
        return definition.inverse;
      } else {
        //TODO add a test for this branch
        if (metaIsRelationshipDefinition(definition)) {
          return definition._inverseKey(this._store, modelClass);
        }
        return null;
      }
    } else {
      return (definition as RelationshipDefinition)._inverseKey(this._store, modelClass);
    }
  }

  inverseIsAsyncForRelationship(type: string, key: string): boolean {
    const modelClass = this._store.modelFor(type);
    const definition = this.relationshipsDefinitionFor(type)[key];
    if (!definition) {
      return false;
    }
    if (CUSTOM_MODEL_CLASS) {
      if (definition.inverse === null) {
        return false;
      }
      if (((definition as unknown) as { inverseIsAsync?: boolean }).inverseIsAsync !== undefined) {
        // TODO do we need to amend the RFC for this prop?
        // else we should add it to the TS interface and document.
        return !!((definition as unknown) as { inverseIsAsync: boolean }).inverseIsAsync;
      } else if (metaIsRelationshipDefinition(definition)) {
        return definition._inverseIsAsync(this._store, modelClass);
      } else {
        return false;
      }
    } else {
      return (definition as RelationshipDefinition)._inverseIsAsync(this._store, modelClass);
    }
  }

  notifyPropertyChange(type: string, id: string | null, lid: string, key: string): void;
  notifyPropertyChange(type: string, id: string, lid: string | null | undefined, key: string): void;
  notifyPropertyChange(type: string, id: string | null, lid: string | null | undefined, key: string): void {
    const resource = constructResource(type, id, lid);
    const identifier = identifierCacheFor(this._store).getOrCreateRecordIdentifier(resource);
    let internalModel = internalModelFactoryFor(this._store).peek(identifier);

    if (internalModel) {
      internalModel.notifyPropertyChange(key);
    }
  }

  notifyHasManyChange(type: string, id: string | null, lid: string, key: string): void;
  notifyHasManyChange(type: string, id: string, lid: string | null | undefined, key: string): void;
  notifyHasManyChange(type: string, id: string | null, lid: string | null | undefined, key: string): void {
    const resource = constructResource(type, id, lid);
    const identifier = identifierCacheFor(this._store).getOrCreateRecordIdentifier(resource);
    this._scheduleManyArrayUpdate(identifier, key);
  }

  notifyBelongsToChange(type: string, id: string | null, lid: string, key: string): void;
  notifyBelongsToChange(type: string, id: string, lid: string | null | undefined, key: string): void;
  notifyBelongsToChange(type: string, id: string | null, lid: string | null | undefined, key: string): void {
    const resource = constructResource(type, id, lid);
    const identifier = identifierCacheFor(this._store).getOrCreateRecordIdentifier(resource);
    let internalModel = internalModelFactoryFor(this._store).peek(identifier);

    if (internalModel) {
      internalModel.notifyBelongsToChange(key);
    }
  }

  notifyStateChange(type: string, id: string, lid: string | null, key?: string): void;
  notifyStateChange(type: string, id: string | null, lid: string, key?: string): void;
  notifyStateChange(type: string, id: string | null, lid: string | null, key?: string): void {
    const resource = constructResource(type, id, lid);
    const identifier = identifierCacheFor(this._store).getOrCreateRecordIdentifier(resource);
    let internalModel = internalModelFactoryFor(this._store).peek(identifier);

    if (internalModel) {
      internalModel.notifyStateChange(key);
    }
  }

  recordDataFor(type: string, id: string, lid?: string | null): RecordData;
  recordDataFor(type: string, id: string | null, lid: string): RecordData;
  recordDataFor(type: string): RecordData;
  recordDataFor(type: string, id?: string | null, lid?: string | null): RecordData {
    let identifier: StableRecordIdentifier | { type: string };
    let isCreate: boolean = false;
    if (!id && !lid) {
      isCreate = true;
      identifier = { type };
    } else {
      const resource = constructResource(type, id, lid);
      identifier = identifierCacheFor(this._store).getOrCreateRecordIdentifier(resource);
    }

    return this._store.recordDataFor(identifier, isCreate);
  }

  setRecordId(type: string, id: string, lid: string) {
    this._store.setRecordId(type, id, lid);
  }

  isRecordInUse(type: string, id: string | null, lid: string): boolean;
  isRecordInUse(type: string, id: string, lid?: string | null): boolean;
  isRecordInUse(type: string, id: string | null, lid?: string | null): boolean {
    const resource = constructResource(type, id, lid);
    const identifier = identifierCacheFor(this._store).getOrCreateRecordIdentifier(resource);
    const internalModel = internalModelFactoryFor(this._store).peek(identifier);

    if (!internalModel) {
      return false;
    }

    const record = internalModel._record;
    return record && !(record.isDestroyed || record.isDestroying);
  }

  disconnectRecord(type: string, id: string | null, lid: string): void;
  disconnectRecord(type: string, id: string, lid?: string | null): void;
  disconnectRecord(type: string, id: string | null, lid?: string | null): void {
    const resource = constructResource(type, id, lid);
    const identifier = identifierCacheFor(this._store).getOrCreateRecordIdentifier(resource);
    let internalModel = internalModelFactoryFor(this._store).peek(identifier);
    if (internalModel) {
      internalModel.destroyFromRecordData();
    }
  }
}
