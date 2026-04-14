import { useState, useRef, useCallback } from 'react'
import { Upload } from 'lucide-react'
import { parseCSVText, parseExcelBuffer } from '../../lib/parse'
import type { DataSeries } from '../../../shared/types'

interface Props {
  onSeries: (series: DataSeries[]) => void
}

export function FileDropZone({ onSeries }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    if (file.name.endsWith('.csv') || file.type === 'text/csv') {
      const text = await file.text()
      onSeries(parseCSVText(text))
    } else {
      const buf = await file.arrayBuffer()
      onSeries(parseExcelBuffer(buf))
    }
  }, [onSeries])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-16 cursor-pointer transition-colors ${
        isDragging
          ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-300 dark:border-gray-700 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      <Upload className="h-10 w-10 text-gray-400" />
      <div className="text-center">
        <p className="text-base font-medium text-gray-700 dark:text-gray-300">
          Drop CSV or Excel file here
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          or click to browse · First column must be dates
        </p>
      </div>
      <input
        ref={inputRef}
        data-testid="file-input"
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={handleFileInput}
      />
    </div>
  )
}
