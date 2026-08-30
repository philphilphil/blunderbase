# Blunderbase

Blunderbase is a local-first personal chess library. Its language distinguishes the
portable library a player owns from the installation and devices through which they use
it.

## Library

**Library**:
The player's portable collection of games, analysis, notes, saved lines, chess accounts,
and preferences. A library remains usable locally without a network connection or paid
account.
_Avoid_: Database, instance

**Library Data**:
Information that belongs to the Library and follows it between synchronized Installations.
_Avoid_: Cloud data, server data

**Analysis Artifact**:
A completed engine or human-move analysis whose inputs and results are fixed. It belongs to
the Library; the work used to produce it does not.
_Avoid_: Job, queue item

**Owner**:
The single player whose chess history and point of view define a Library.
_Avoid_: User, tenant

**Chess Account**:
An identity under which the Owner plays on a chess platform. It is not a Blunderbase login
or subscription identity.
_Avoid_: User account, login

## Distribution

**Installation**:
A complete running copy of Blunderbase with its own local Library copy. Desktop and Docker
are different ways to host an Installation.
_Avoid_: Server, instance

**Device-local Data**:
Configuration, credentials, transient work, and resources that belong to one Installation
and never follow the Library during synchronization.
_Avoid_: Library Data

**Sync Home**:
The designated always-reachable Installation through which other Installations exchange
Library changes. It also serves Companions while desktop Installations are offline.
_Avoid_: Cloud, master, primary

**Companion**:
The mobile Blunderbase application. It uses a reachable Installation and may cache data,
but it is not itself a complete Installation.
_Avoid_: Mobile instance, replica

**Managed Sync**:
The paid operation of a Sync Home by the Blunderbase project. The same capability remains
available through a self-hosted Installation.
_Avoid_: Premium sync protocol
