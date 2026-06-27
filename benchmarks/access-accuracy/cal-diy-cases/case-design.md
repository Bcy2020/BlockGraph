# Cal.com DIY Benchmark Cases

## Block Structure

| Block | Entities | Purpose |
|-------|----------|---------|
| Platform SDK | 32 | Platform atoms and providers |
| Authentication | 32 | Auth flows, sessions, passwords |
| tRPC API Layer | 28 | API routers and context |
| Shared Features | 23 | Feature flags, shared logic |
| Event Types | 20 | Event type management |
| Availability | 18 | Availability scheduling |
| Calendars | 16 | Calendar integrations |
| Bookings | 16 | Booking management |
| Embed | 12 | Embedding widgets |
| Shared UI | 10 | Shared UI components |
| Web App Shell | 9 | Web app structure |
| Database Schema | 7 | Prisma schema |
| Notifications | 6 | Email/notification |
| Video Conferencing | 5 | Video integration |
| Config Infrastructure | 3 | Configuration |

## Case Design Rules

1. Each case must have a clear, unambiguous golden answer
2. Golden answers must be verifiable from source code
3. Cases should test different aspects of localization
4. Avoid cases where multiple valid interpretations exist

## Cases

### 1. booking-created-notification (bug_localization)

**Task**: When a booking is created, the confirmation email is not sent. The booking is saved to the database correctly, but the user never receives the notification. Where should an agent inspect first?

**Golden**:
- Files: `packages/features/bookings/lib/handleNewBooking.ts`, `packages/features/notifications/notifications.ts`
- Entities: `handleNewBooking`, `sendNotification`
- Blocks: `Bookings`, `Notifications`

### 2. event-type-not-found (bug_localization)

**Task**: Users report that some event types return 404 even though they exist in the database. The issue seems related to how event types are fetched for team events. Where is the likely bug?

**Golden**:
- Files: `packages/features/eventtypes/lib/getPublicEvent.ts`, `packages/trpc/server/routers/viewer/eventTypes.ts`
- Entities: `getPublicEvent`, `eventTypes`
- Blocks: `Event Types`, `tRPC API Layer`

### 3. calendar-sync-failure (bug_localization)

**Task**: Google Calendar events are not syncing correctly. The API returns success but events don't appear in Cal.com. Where should the agent look?

**Golden**:
- Files: `packages/app-store/googlecalendar/lib/CalendarService.ts`, `packages/features/calendars/lib/CalendarManager.ts`
- Entities: `CalendarService`, `CalendarManager`
- Blocks: `Calendars`

### 4. availability-override (bug_localization)

**Task**: When a user sets override availability for a specific date, the override is ignored and the default schedule is used instead. Where is the bug?

**Golden**:
- Files: `packages/features/availability/lib/getAvailability.ts`, `packages/features/availability/lib/parseAvailability.ts`
- Entities: `getAvailability`, `parseAvailability`
- Blocks: `Availability`

### 5. booking-reschedule-race (bug_localization)

**Task**: When two users try to reschedule the same booking at the same time, both succeed and create duplicate entries. Where is the race condition?

**Golden**:
- Files: `packages/features/bookings/lib/handleNewBooking.ts`, `packages/features/bookings/lib/handleReschedule.ts`
- Entities: `handleReschedule`, `handleNewBooking`
- Blocks: `Bookings`

### 6. add-recurring-event (feature_landing_zone)

**Task**: A new feature needs to be added to support recurring events (e.g., weekly meetings). Where should the new code be inserted?

**Golden**:
- Files: `packages/features/eventtypes/lib/`, `packages/prisma/schema.prisma`
- Entities: `EventType`, `eventTypes`
- Blocks: `Event Types`, `Database Schema`

### 7. add-team-availability (feature_landing_zone)

**Task**: Add a feature that allows team admins to view and manage team member availability in one place. Where should this be implemented?

**Golden**:
- Files: `packages/features/availability/lib/`, `packages/trpc/server/routers/viewer/availability.ts`
- Entities: `availability`, `teamAvailability`
- Blocks: `Availability`, `tRPC API Layer`

### 8. add-booking-embed (feature_landing_zone)

**Task**: Add support for embedding the booking flow in external websites via iframe. Where should the new embed component be added?

**Golden**:
- Files: `packages/embed/`, `packages/features/bookings/`
- Entities: `Embed`, `Bookings`
- Blocks: `Embed`, `Bookings`

### 9. add-payment-integration (feature_landing_zone)

**Task**: Add Stripe payment integration for paid bookings. Where should the payment logic be inserted?

**Golden**:
- Files: `packages/app-store/stripepayment/`, `packages/features/bookings/lib/handleNewBooking.ts`
- Entities: `handleNewBooking`, `stripePayment`
- Blocks: `Bookings`

### 10. add-webhook-notifications (feature_landing_zone)

**Task**: Add webhook support so external services can receive booking notifications. Where should the webhook dispatch logic be added?

**Golden**:
- Files: `packages/features/webhooks/`, `packages/features/bookings/lib/handleNewBooking.ts`
- Entities: `sendWebhook`, `handleNewBooking`
- Blocks: `Bookings`, `Notifications`

### 11. auth-token-impact (impact_analysis)

**Task**: The authentication token format is being changed from JWT to opaque tokens. Which files and modules will be affected?

**Golden**:
- Files: `packages/features/auth/lib/next-auth-options.ts`, `packages/features/auth/lib/getServerSession.ts`, `packages/trpc/server/createContext.ts`
- Entities: `next-auth-options`, `getServerSession`, `createContext`
- Blocks: `Authentication`, `tRPC API Layer`

### 12. prisma-schema-change (impact_analysis)

**Task**: The `Booking` model in Prisma schema needs to add a new `status` field. What other files will need to be updated?

**Golden**:
- Files: `packages/prisma/schema.prisma`, `packages/features/bookings/lib/`, `packages/trpc/server/routers/viewer/bookings.ts`
- Entities: `Booking`, `bookings`, `handleNewBooking`
- Blocks: `Database Schema`, `Bookings`, `tRPC API Layer`

### 13. api-rate-limit-change (impact_analysis)

**Task**: The API rate limit is being reduced from 100 to 10 requests per minute. Which modules will be affected?

**Golden**:
- Files: `packages/trpc/server/trpc.ts`, `apps/api/v2/src/`
- Entities: `trpc`, `rateLimit`
- Blocks: `tRPC API Layer`, `API App Shell`

### 14. shared-ui-migration (impact_analysis)

**Task**: The shared UI component library is being migrated from one version to another. Which modules depend on it?

**Golden**:
- Files: `packages/ui/`, `packages/features/`, `apps/web/`
- Entities: `Button`, `Dialog`, `Form`
- Blocks: `Shared UI`, `Web App Shell`, `Shared Features`

### 15. calendar-provider-change (impact_analysis)

**Task**: The Google Calendar API is being upgraded from v3 to v4. Which files need to be updated?

**Golden**:
- Files: `packages/app-store/googlecalendar/`, `packages/features/calendars/`
- Entities: `CalendarService`, `CalendarManager`
- Blocks: `Calendars`

### 16. booking-to-payment-flow (cross_module_flow)

**Task**: Trace the complete flow from when a user creates a booking to when payment is processed. What are the key files and functions involved?

**Golden**:
- Files: `packages/features/bookings/lib/handleNewBooking.ts`, `packages/app-store/stripepayment/lib/payment.ts`
- Entities: `handleNewBooking`, `processPayment`, `stripePayment`
- Blocks: `Bookings`

### 17. auth-to-booking-flow (cross_module_flow)

**Task**: Trace the flow from user authentication to creating a booking. What are the key steps?

**Golden**:
- Files: `packages/features/auth/lib/getServerSession.ts`, `packages/features/bookings/lib/handleNewBooking.ts`
- Entities: `getServerSession`, `handleNewBooking`
- Blocks: `Authentication`, `Bookings`

### 18. event-type-creation-flow (cross_module_flow)

**Task**: Trace the complete flow of creating a new event type, from UI to database. What are the key files?

**Golden**:
- Files: `packages/trpc/server/routers/viewer/eventTypes.ts`, `packages/features/eventtypes/lib/`, `packages/prisma/schema.prisma`
- Entities: `eventTypes`, `EventType`
- Blocks: `Event Types`, `tRPC API Layer`, `Database Schema`

### 19. embed-loading-flow (cross_module_flow)

**Task**: Trace how the embed widget loads and initializes. What are the key files and functions?

**Golden**:
- Files: `packages/embed/iframe/`, `packages/embed/react/`
- Entities: `Embed`, `CalProvider`
- Blocks: `Embed`, `Platform SDK`

### 20. notification-delivery-flow (cross_module_flow)

**Task**: Trace the flow of how a booking notification is delivered to the user. What are the key steps?

**Golden**:
- Files: `packages/features/bookings/lib/handleNewBooking.ts`, `packages/features/notifications/notifications.ts`
- Entities: `handleNewBooking`, `sendNotification`
- Blocks: `Bookings`, `Notifications`
