git reset HEAD~1
rm ./backport.sh
git cherry-pick 7ef13612e632faf54947d5bb88f9fddd3c6a91cc
echo 'Resolve conflicts and force push this branch.\n\nTo backport translations run: bin/i18n/merge-translations <release-branch>'
