import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({ title, children, onClose }: {
  title: string; children: ReactNode; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.showModal()
    return () => {
      dialog.current?.close()
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])
  return (
    <dialog ref={dialog} onCancel={onClose} aria-labelledby="modal-title" className="modal">
      <header><h2 id="modal-title">{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="modal-content">{children}</div>
      <footer><button className="primary-button" onClick={onClose}>Got it</button></footer>
    </dialog>
  )
}
