import { RouterProvider } from 'react-router-dom'

import { Providers } from './app/Providers'
import { router } from './app/router'

export default function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  )
}
