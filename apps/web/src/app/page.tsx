import { redirect } from 'next/navigation'

/** The dashboard is the app. The proxy sends signed-out visitors to the login page. */
export default function Home() {
  redirect('/dashboard')
}
