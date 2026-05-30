import { errMessage } from './errors.js'

export const jsonResult = (payload: unknown) => {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
  }
}

export const errorResult = (action: string, error: unknown) => ({
  isError: true as const,
  content: [{ type: 'text' as const, text: `Error ${action}: ${errMessage(error)}` }]
})
