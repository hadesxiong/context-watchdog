import { ref, computed } from 'vue'
import { useDetectionStore } from '../stores/detection'

export function useDetector() {
  const store = useDetectionStore()
  const inputText = ref('')

  const isProcessing = computed(() => store.isProcessing)
  const hasResults = computed(() => store.detections.length > 0)
  const detections = computed(() => store.detections)
  const sanitizedText = computed(() => store.sanitizedText)

  const detect = async (text: string) => {
    inputText.value = text
    await store.detect(text)
  }

  const setReplaceAction = (
    itemId: string,
    action: 'replace' | 'keep'
  ) => {
    store.setReplaceAction(itemId, action)
  }

  const replaceAll = () => {
    store.replaceAll()
  }

  const keepAll = () => {
    store.keepAll()
  }

  const copySanitizedText = async () => {
    return await store.copySanitizedText()
  }

  const clearAll = () => {
    inputText.value = ''
    store.clearAll()
  }

  return {
    inputText,
    isProcessing,
    hasResults,
    detections,
    sanitizedText,
    detect,
    setReplaceAction,
    replaceAll,
    keepAll,
    copySanitizedText,
    clearAll
  }
}
