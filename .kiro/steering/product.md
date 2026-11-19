# Product

doctor7-onprem is a psychological care platform that a clinic runs on its own
server. It is a rebuild of the hosted Doctor7 service for on-premise use.

## Users

- Clinicians who schedule and run consultations.
- Patients who attend consultations.
- Administrators who install and maintain the server.

## Goals

- Run on a single Debian server with Apache and MariaDB, without containers.
- Support video consultations through Google Meet or Jitsi, chosen by
  configuration. The application code does not depend on one provider.
- Keep all data on the customer's server.

## Constraints

- All repository data is synthetic. No real patient data, credentials, or cloud
  configuration are stored in the repository.
- All public text is in English.
- The project is submitted to Kiroween in the Frankenstein category.
