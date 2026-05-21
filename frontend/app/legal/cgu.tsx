import { LegalPageWrapper, H2, H3, P, Bold, Bullet, InfoBox } from "@/src/legal/LegalPageWrapper";
import { COMPANY } from "@/src/legal/companyInfo";

export default function CGU() {
  return (
    <LegalPageWrapper
      title="Conditions Générales d'Utilisation"
      subtitle="Les présentes CGU régissent l'utilisation du service CINÉMARIÉS édité par CREATIVINDUSTRY FRANCE."
      lastUpdate={COMPANY.lastUpdate}
    >
      <H2>Article 1 — Objet</H2>
      <P>
        Les présentes Conditions Générales d'Utilisation (« CGU ») ont pour objet de définir les modalités et conditions dans lesquelles {COMPANY.legalName} (« {COMPANY.sigle} », « nous », « l'Éditeur ») met à disposition de toute personne (« Utilisateur », « vous ») le service de streaming vidéo {COMPANY.brand} accessible via le site web {COMPANY.appWebsite} et l'application mobile Android/iOS.
      </P>

      <H2>Article 2 — Acceptation</H2>
      <P>
        L'utilisation du service implique l'acceptation pleine et entière des présentes CGU. En créant un compte, en saisissant un code d'accès ou en effectuant un paiement, l'Utilisateur reconnaît avoir lu, compris et accepté les CGU et la Politique de Confidentialité.
      </P>

      <H2>Article 3 — Description du service</H2>
      <P>{COMPANY.serviceDescription}</P>
      <P>Le service propose principalement :</P>
      <Bullet>Le visionnage de films de mariage personnalisés via un <Bold>code d'accès unique</Bold> à 8 caractères, transmis par le client (les mariés)</Bullet>
      <Bullet>Un abonnement <Bold>Premium</Bold> permettant aux mariés de générer leurs codes d'invitation et partager leurs films</Bullet>
      <Bullet>Un service d'<Bold>hébergement à vie</Bold> de leurs films pour 90 € (paiement unique)</Bullet>
      <Bullet>Une fonctionnalité de diffusion <Bold>Chromecast / Google Cast</Bold> vers un téléviseur compatible</Bullet>

      <H2>Article 4 — Création de compte</H2>
      <Bullet>L'inscription est gratuite et nécessite une adresse email valide</Bullet>
      <Bullet>L'Utilisateur garantit l'exactitude des informations fournies</Bullet>
      <Bullet>L'Utilisateur s'engage à conserver la confidentialité de ses identifiants</Bullet>
      <Bullet>L'Utilisateur déclare être majeur (18 ans révolus) ou disposer du consentement de son représentant légal</Bullet>
      <Bullet>Tout compte multiple, frauduleux ou usurpant l'identité d'un tiers sera supprimé sans préavis</Bullet>

      <H2>Article 5 — Règle « 1 code = 1 appareil »</H2>
      <InfoBox>
        Pour des raisons de <Bold>sécurité et de protection de la vie privée des mariés</Bold>, chaque code d'accès est lié à un seul appareil après première utilisation.
      </InfoBox>
      <P>
        Lorsqu'un code est saisi pour la première fois, il est associé de manière permanente à l'identifiant unique de l'appareil utilisé. Toute tentative de réutilisation du code sur un autre appareil sera refusée. Pour visionner le film sur un autre appareil, le client doit générer un nouveau code via son espace Premium.
      </P>

      <H2>Article 6 — Tarifs et paiements</H2>
      <Bullet><Bold>Abonnement Premium Mariés</Bold> : {COMPANY.pricing.subscription.label}, sans engagement</Bullet>
      <Bullet><Bold>Abonnement Premium Illimité</Bold> : {COMPANY.pricing.subscriptionUnlimited.label}, sans engagement</Bullet>
      <Bullet><Bold>Hébergement à vie</Bold> : {COMPANY.pricing.hosting.label}</Bullet>
      <P>
        Les paiements sont traités par <Bold>Stripe Payments Europe Ltd</Bold> via une connexion sécurisée. Aucune donnée de carte bancaire n'est stockée par {COMPANY.legalName}. Les modalités détaillées figurent dans les CGV.
      </P>

      <H2>Article 7 — Obligations de l'Utilisateur</H2>
      <P>L'Utilisateur s'engage à :</P>
      <Bullet>Utiliser le service conformément à sa destination personnelle et non commerciale</Bullet>
      <Bullet>Ne pas tenter de contourner les mesures de sécurité (DRM, limitation 1 code = 1 appareil)</Bullet>
      <Bullet>Ne pas télécharger, copier, capturer ou rediffuser les films par tout moyen</Bullet>
      <Bullet>Ne pas partager publiquement son code d'accès ou ses identifiants</Bullet>
      <Bullet>Ne pas utiliser de robots, scripts ou outils automatisés pour accéder au service</Bullet>
      <Bullet>Respecter les droits de propriété intellectuelle des mariés et de {COMPANY.legalName}</Bullet>

      <H2>Article 8 — Propriété intellectuelle</H2>
      <P>
        Tous les contenus présents sur le service (interface, logo, marque {COMPANY.brand}, charte graphique, codes sources) sont la propriété exclusive de {COMPANY.legalName} et protégés par le droit français et international.
      </P>
      <P>
        Les <Bold>films de mariage</Bold> demeurent la propriété de leurs clients respectifs. {COMPANY.legalName} dispose d'un mandat de diffusion contractuel. Toute reproduction non autorisée constitue une contrefaçon (articles L.335-2 et suivants du Code de la propriété intellectuelle), passible de 3 ans d'emprisonnement et 300 000 € d'amende.
      </P>

      <H2>Article 9 — Disponibilité du service</H2>
      <P>
        {COMPANY.legalName} met en œuvre tous les moyens raisonnables pour assurer un accès continu au service. Toutefois, l'Éditeur ne peut garantir une disponibilité 100% et ne saurait être tenu responsable des interruptions liées à :
      </P>
      <Bullet>La maintenance technique programmée (notifiée à l'avance dans la mesure du possible)</Bullet>
      <Bullet>Les pannes des opérateurs télécoms et fournisseurs d'accès Internet</Bullet>
      <Bullet>Les cas de force majeure (cyberattaques, catastrophes naturelles, etc.)</Bullet>

      <H2>Article 10 — Suspension et résiliation</H2>
      <P>
        {COMPANY.legalName} se réserve le droit de suspendre ou supprimer tout compte en cas de :
      </P>
      <Bullet>Violation des présentes CGU</Bullet>
      <Bullet>Fraude, usurpation d'identité, partage illicite de contenus</Bullet>
      <Bullet>Non-paiement après mise en demeure restée infructueuse</Bullet>
      <Bullet>Tentative d'atteinte à la sécurité du système</Bullet>
      <P>
        L'Utilisateur peut résilier son compte à tout moment depuis son profil ou en écrivant à {COMPANY.email}.
      </P>

      <H2>Article 11 — Responsabilité</H2>
      <P>
        Le service est fourni « en l'état ». {COMPANY.legalName} ne saurait être tenu pour responsable :
      </P>
      <Bullet>Des dommages indirects (perte de données utilisateur, perte de chance, préjudice moral)</Bullet>
      <Bullet>D'une utilisation non conforme du service par l'Utilisateur</Bullet>
      <Bullet>Des dysfonctionnements liés à l'équipement de l'Utilisateur (navigateur obsolète, connexion défaillante)</Bullet>
      <P>
        La responsabilité maximale de {COMPANY.legalName}, tous préjudices confondus, est strictement limitée au montant payé par l'Utilisateur au cours des 12 derniers mois, sauf faute lourde ou intentionnelle.
      </P>

      <H2>Article 12 — Données personnelles</H2>
      <P>
        Le traitement des données personnelles est régi par notre <Bold>Politique de Confidentialité</Bold> accessible depuis l'application et le site web, conforme au RGPD.
      </P>

      <H2>Article 13 — Modification des CGU</H2>
      <P>
        {COMPANY.legalName} se réserve le droit de modifier les présentes CGU à tout moment. Les Utilisateurs seront informés par email ou via l'application des modifications substantielles. À défaut d'opposition formelle dans un délai de 30 jours, les nouvelles CGU s'appliqueront.
      </P>

      <H2>Article 14 — Droit applicable et juridiction</H2>
      <P>
        Les présentes CGU sont soumises au <Bold>droit français</Bold>. Tout litige relatif à leur exécution, interprétation ou validité sera, à défaut de règlement amiable, porté devant les tribunaux compétents de Paris, sauf dispositions impératives en faveur du consommateur.
      </P>

      <InfoBox>
        Pour toute question relative à ces CGU : <Bold>{COMPANY.email}</Bold>
      </InfoBox>
    </LegalPageWrapper>
  );
}
