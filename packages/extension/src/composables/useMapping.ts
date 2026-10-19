import { computed } from 'vue'
import { useDetectionStore } from '../stores/detection'
import type { MappingTable } from '@engine/types'

export function useMapping() {
  const store = useDetectionStore()

  const mappingTable = computed<MappingTable>(() => store.mappingTable)
  const mappingCount = computed(() => Object.keys(store.mappingTable).length)

  const clearMapping = () => {
    store.clearMapping()
  }

  const getOriginal = (placeholder: string): string | undefined => {
    return store.mappingTable[placeholder]
  }

  return {
    mappingTable,
    mappingCount,
    clearMapping,
    getOriginal
  }
}
